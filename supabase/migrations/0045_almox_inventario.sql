-- =============================================================================
-- CRM/ERP NOVALUZ — 0045 Almoxarifado · Bloco 1: saldos iniciais e inventário
--
-- inventarios / inventario_itens
--   Rascunho: o almoxarifado lança a quantidade contada (ou cola do Excel).
--   Confirmar (rpc confirmar_inventario): compara com o saldo do depósito NA
--   HORA e lança a diferença como movimentação (origem 'inventario'):
--     contado > sistema → entrada (custo informado ou custo médio atual)
--     contado < sistema → saída
--   Depois de confirmado o inventário fica travado.
--   tipo 'saldo_inicial' (implantação) ou 'contagem' (inventário periódico).
--
-- Ajuste de estoque passa a aceitar quantidade negativa (antes só somava).
--
-- Depende de 0005 (estoque), 0025 (numeração), 0040 (pode()).
-- =============================================================================

-- 1) Ajuste com sinal -------------------------------------------------------------
alter table movimentacoes_estoque drop constraint if exists movimentacoes_estoque_quantidade_check;
alter table movimentacoes_estoque drop constraint if exists movimentacoes_estoque_qtd_check;
alter table movimentacoes_estoque add constraint movimentacoes_estoque_qtd_check
  check ((tipo = 'ajuste' and quantidade <> 0) or (tipo <> 'ajuste' and quantidade > 0));

create or replace function aplicar_movimentacao_estoque()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo_atual numeric(14,3);
  v_custo_atual numeric(14,4);
  v_novo_saldo  numeric(14,3);
  v_saldo_total numeric(14,3);
begin
  insert into saldos_estoque (empresa_consultora_id, produto_id, deposito_id, quantidade)
  values (new.empresa_consultora_id, new.produto_id, new.deposito_id, 0)
  on conflict (produto_id, deposito_id) do nothing;

  select quantidade into v_saldo_atual
    from saldos_estoque where produto_id = new.produto_id and deposito_id = new.deposito_id for update;
  select coalesce(custo_medio, 0) into v_custo_atual from produtos where id = new.produto_id;

  if new.tipo = 'entrada' then
    if new.custo_unitario is null then
      raise exception 'Entrada de estoque exige custo_unitario';
    end if;
    select coalesce(sum(quantidade), 0) into v_saldo_total from saldos_estoque where produto_id = new.produto_id;
    update produtos
       set custo_medio = case when (v_saldo_total + new.quantidade) > 0
                              then ((greatest(v_saldo_total, 0) * v_custo_atual) + (new.quantidade * new.custo_unitario))
                                   / (greatest(v_saldo_total, 0) + new.quantidade)
                              else new.custo_unitario end
     where id = new.produto_id;
    update saldos_estoque set quantidade = quantidade + new.quantidade, atualizado_em = now()
     where produto_id = new.produto_id and deposito_id = new.deposito_id;

  elsif new.tipo = 'saida' then
    v_novo_saldo := v_saldo_atual - new.quantidade;
    if v_novo_saldo < 0 then
      raise exception 'Estoque insuficiente: saldo %, saída %', v_saldo_atual, new.quantidade;
    end if;
    new.custo_unitario := v_custo_atual;
    update saldos_estoque set quantidade = v_novo_saldo, atualizado_em = now()
     where produto_id = new.produto_id and deposito_id = new.deposito_id;

  elsif new.tipo = 'ajuste' then
    -- quantidade com sinal: positiva soma, negativa baixa; não altera custo médio
    v_novo_saldo := v_saldo_atual + new.quantidade;
    if v_novo_saldo < 0 then
      raise exception 'Ajuste deixaria o saldo negativo: saldo %, ajuste %', v_saldo_atual, new.quantidade;
    end if;
    new.custo_unitario := coalesce(new.custo_unitario, v_custo_atual);
    update saldos_estoque set quantidade = v_novo_saldo, atualizado_em = now()
     where produto_id = new.produto_id and deposito_id = new.deposito_id;
  end if;

  return new;
end $$;

-- 2) Inventário --------------------------------------------------------------------
create table if not exists inventarios (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  numero                text,
  deposito_id           uuid not null references depositos(id),
  tipo                  text not null default 'contagem' check (tipo in ('saldo_inicial','contagem')),
  data                  date not null default current_date,
  status                text not null default 'rascunho' check (status in ('rascunho','confirmado','cancelado')),
  observacao            text,
  criado_por            uuid references perfis(id) on delete set null default auth.uid(),
  confirmado_por        uuid references perfis(id) on delete set null,
  confirmado_em         timestamptz,
  criado_em             timestamptz not null default now()
);

create table if not exists inventario_itens (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  inventario_id         uuid not null references inventarios(id) on delete cascade,
  produto_id            uuid not null references produtos(id),
  quantidade_contada    numeric(14,3),                 -- null = ainda não contado
  custo_unitario        numeric(14,4),                 -- opcional (saldo inicial); vazio = custo médio
  quantidade_sistema    numeric(14,3),                 -- gravado na confirmação
  diferenca             numeric(14,3),                 -- gravado na confirmação
  observacao            text,
  atualizado_em         timestamptz not null default now(),
  unique (inventario_id, produto_id)
);
create index if not exists idx_inventario_itens on inventario_itens(inventario_id);
create index if not exists idx_inventarios_empresa on inventarios(empresa_consultora_id, criado_em desc);

drop trigger if exists trg_num on inventarios;
create trigger trg_num before insert on inventarios
  for each row execute function set_numero_auto('INV', 'inventario');

-- itens só mudam enquanto o inventário é rascunho
create or replace function _inventario_travado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from inventarios where id = coalesce(new.inventario_id, old.inventario_id);
  if v_status is distinct from 'rascunho' and current_setting('app.confirmando_inventario', true) is distinct from 'on' then
    raise exception 'Inventário % não pode mais ser alterado', v_status;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_inventario_travado on inventario_itens;
create trigger trg_inventario_travado before insert or update or delete on inventario_itens
  for each row execute function _inventario_travado();

-- RLS: módulo Estoque (helper reaproveitável; em 0040 foi descartado ao fim)
create or replace function _aplicar_acesso(p_tabela text, p_ler text[], p_escrever text[])
returns void language plpgsql as $$
declare
  v_ten text := 'empresa_consultora_id = (select auth_empresa_id())';
  v_ler text := format('(select pode(%L::text[], ''ver''))', p_ler);
  v_esc text := format('(select pode(%L::text[], ''editar''))', p_escrever);
begin
  if to_regclass('public.' || p_tabela) is null then return; end if;
  execute format('alter table %I enable row level security', p_tabela);
  execute format('drop policy if exists tenant_all on %I', p_tabela);
  execute format('drop policy if exists acesso_ler on %I', p_tabela);
  execute format('drop policy if exists acesso_inserir on %I', p_tabela);
  execute format('drop policy if exists acesso_alterar on %I', p_tabela);
  execute format('drop policy if exists acesso_excluir on %I', p_tabela);
  execute format('create policy acesso_ler on %I for select using (%s and %s)', p_tabela, v_ten, v_ler);
  execute format('create policy acesso_inserir on %I for insert with check (%s and %s)', p_tabela, v_ten, v_esc);
  execute format('create policy acesso_alterar on %I for update using (%s and %s) with check (%s and %s)',
                 p_tabela, v_ten, v_esc, v_ten, v_esc);
  execute format('create policy acesso_excluir on %I for delete using (%s and %s)', p_tabela, v_ten, v_esc);
end $$;
revoke execute on function _aplicar_acesso(text, text[], text[]) from public, anon, authenticated;

select _aplicar_acesso('inventarios',      '{estoque}', '{estoque}');
select _aplicar_acesso('inventario_itens', '{estoque}', '{estoque}');

-- 3) Confirmação ---------------------------------------------------------------------
create or replace function confirmar_inventario(p_inventario uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_inv   inventarios%rowtype;
  it      record;
  v_sis   numeric(14,3);
  v_dif   numeric(14,3);
  v_custo numeric(14,4);
  n       int := 0;
begin
  if not pode('{estoque}', 'editar') then raise exception 'Sem permissão no módulo Estoque'; end if;
  select * into v_inv from inventarios where id = p_inventario for update;
  if not found or v_inv.empresa_consultora_id <> auth_empresa_id() then raise exception 'Inventário não encontrado'; end if;
  if v_inv.status <> 'rascunho' then raise exception 'Inventário já está %', v_inv.status; end if;

  perform set_config('app.confirmando_inventario', 'on', true);

  for it in select i.*, p.custo_medio, p.nome
              from inventario_itens i join produtos p on p.id = i.produto_id
             where i.inventario_id = p_inventario and i.quantidade_contada is not null
  loop
    select coalesce(quantidade, 0) into v_sis from saldos_estoque
     where produto_id = it.produto_id and deposito_id = v_inv.deposito_id;
    v_sis := coalesce(v_sis, 0);
    v_dif := it.quantidade_contada - v_sis;

    if v_dif > 0 then
      v_custo := coalesce(it.custo_unitario, it.custo_medio, 0);
      insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade,
                                         custo_unitario, origem, referencia_id, data, observacao)
      values (v_inv.empresa_consultora_id, it.produto_id, v_inv.deposito_id, 'entrada', v_dif, v_custo,
              'inventario', v_inv.id, now(),
              case v_inv.tipo when 'saldo_inicial' then 'Saldo inicial ' else 'Inventário ' end || coalesce(v_inv.numero, ''));
      n := n + 1;
    elsif v_dif < 0 then
      insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade,
                                         origem, referencia_id, data, observacao)
      values (v_inv.empresa_consultora_id, it.produto_id, v_inv.deposito_id, 'saida', -v_dif,
              'inventario', v_inv.id, now(), 'Inventário ' || coalesce(v_inv.numero, '') || ' (falta na contagem)');
      n := n + 1;
    end if;

    update inventario_itens set quantidade_sistema = v_sis, diferenca = v_dif, atualizado_em = now()
     where id = it.id;
  end loop;

  update inventarios set status = 'confirmado', confirmado_por = auth.uid(), confirmado_em = now()
   where id = p_inventario;
  return n;
end $$;

grant execute on function confirmar_inventario(uuid) to authenticated;
