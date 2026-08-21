-- =============================================================================
-- CRM/ERP NOVALUZ — 0005 ESTOQUE (movimentações + saldos + custo médio)
-- Modelo append-only: movimentações não se editam; para corrigir, lance um
-- ajuste. Triggers mantêm saldo (por depósito) e custo médio (por produto).
-- =============================================================================

-- SALDOS por (produto, depósito) ----------------------------------------------
create table if not exists saldos_estoque (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  produto_id            uuid not null references produtos(id) on delete cascade,
  deposito_id           uuid not null references depositos(id) on delete cascade,
  quantidade            numeric(14,3) not null default 0,
  atualizado_em         timestamptz not null default now(),
  unique (produto_id, deposito_id)
);

-- MOVIMENTAÇÕES (append-only) -------------------------------------------------
create table if not exists movimentacoes_estoque (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  produto_id            uuid not null references produtos(id),
  deposito_id           uuid not null references depositos(id),
  tipo                  text not null check (tipo in ('entrada','saida','ajuste')),
  quantidade            numeric(14,3) not null check (quantidade > 0),
  custo_unitario        numeric(14,4),          -- obrigatório na entrada; na saída é preenchido pelo custo médio
  origem                text not null default 'manual' check (origem in ('manual','compra','producao','ajuste','inventario')),
  referencia_id         uuid,                   -- pedido de compra, obra, etc.
  data                  timestamptz not null default now(),
  observacao            text
);

create index if not exists idx_mov_estoque_produto on movimentacoes_estoque(produto_id);
create index if not exists idx_mov_estoque_data     on movimentacoes_estoque(empresa_consultora_id, data desc);
create index if not exists idx_saldos_produto        on saldos_estoque(produto_id);

-- TRIGGER: aplica a movimentação ao saldo e ao custo médio ---------------------
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
begin
  -- garante linha de saldo
  insert into saldos_estoque (empresa_consultora_id, produto_id, deposito_id, quantidade)
  values (new.empresa_consultora_id, new.produto_id, new.deposito_id, 0)
  on conflict (produto_id, deposito_id) do nothing;

  select quantidade into v_saldo_atual
  from saldos_estoque where produto_id = new.produto_id and deposito_id = new.deposito_id for update;

  select custo_medio into v_custo_atual from produtos where id = new.produto_id;

  if new.tipo = 'entrada' then
    if new.custo_unitario is null then
      raise exception 'Entrada de estoque exige custo_unitario';
    end if;
    -- custo médio ponderado (considera saldo total do produto em todos os depósitos)
    declare
      v_saldo_total numeric(14,3);
    begin
      select coalesce(sum(quantidade),0) into v_saldo_total from saldos_estoque where produto_id = new.produto_id;
      update produtos
        set custo_medio = case when (v_saldo_total + new.quantidade) > 0
                               then ((v_saldo_total * v_custo_atual) + (new.quantidade * new.custo_unitario)) / (v_saldo_total + new.quantidade)
                               else new.custo_unitario end
        where id = new.produto_id;
    end;
    update saldos_estoque set quantidade = quantidade + new.quantidade, atualizado_em = now()
      where produto_id = new.produto_id and deposito_id = new.deposito_id;

  elsif new.tipo = 'saida' then
    v_novo_saldo := v_saldo_atual - new.quantidade;
    if v_novo_saldo < 0 then
      raise exception 'Estoque insuficiente: saldo % , saída %', v_saldo_atual, new.quantidade;
    end if;
    -- registra o custo da saída pelo custo médio vigente (não altera custo médio)
    new.custo_unitario := v_custo_atual;
    update saldos_estoque set quantidade = v_novo_saldo, atualizado_em = now()
      where produto_id = new.produto_id and deposito_id = new.deposito_id;

  elsif new.tipo = 'ajuste' then
    -- ajuste define a quantidade como delta assinado via sinal em observacao? Simplificado:
    -- trata ajuste como entrada/saída conforme custo informado; aqui soma direto.
    update saldos_estoque set quantidade = quantidade + new.quantidade, atualizado_em = now()
      where produto_id = new.produto_id and deposito_id = new.deposito_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_mov_estoque on movimentacoes_estoque;
create trigger trg_mov_estoque
  before insert on movimentacoes_estoque
  for each row execute function aplicar_movimentacao_estoque();
