-- =============================================================================
-- CRM/ERP NOVALUZ — 0056 Compras · entrega direta na obra / OS / setor
--
-- Material comprado que vai direto para o destino (não fica no almoxarifado):
--   receber_pedido() com destino_tipo → além da entrada do recebimento, gera na
--   mesma transação um vale de saída (VS-) com o destino, igual ao balcão.
--   Resultado: saldo do depósito não muda, custo cai na obra/OS/setor.
--
-- Custo: a saída da entrega direta usa o PREÇO DO PEDIDO (não o custo médio),
-- e a entrada correspondente não mexe no custo médio do produto — o material
-- só passou pelo estoque. Controlado pela flag de transação app.entrega_direta.
--
-- Itens de patrimônio (ferramentas) não saem: continuam virando ferramenta.
--
-- Depende de 0045 (trigger de estoque), 0046 (vales), 0047/0048 (recebimento).
-- =============================================================================

alter table recebimentos_compra add column if not exists vale_id uuid references vales_almox(id) on delete set null;

-- 1) Trigger de estoque: respeita a flag da entrega direta -----------------------------
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
  v_direta      boolean := current_setting('app.entrega_direta', true) = 'on';
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
    if not v_direta then   -- entrega direta só passa pelo estoque: não altera o custo médio
      select coalesce(sum(quantidade), 0) into v_saldo_total from saldos_estoque where produto_id = new.produto_id;
      update produtos
         set custo_medio = case when (v_saldo_total + new.quantidade) > 0
                                then ((greatest(v_saldo_total, 0) * v_custo_atual) + (new.quantidade * new.custo_unitario))
                                     / (greatest(v_saldo_total, 0) + new.quantidade)
                                else new.custo_unitario end
       where id = new.produto_id;
    end if;
    update saldos_estoque set quantidade = quantidade + new.quantidade, atualizado_em = now()
     where produto_id = new.produto_id and deposito_id = new.deposito_id;

  elsif new.tipo = 'saida' then
    v_novo_saldo := v_saldo_atual - new.quantidade;
    if v_novo_saldo < 0 then
      raise exception 'Estoque insuficiente: saldo %, saída %', v_saldo_atual, new.quantidade;
    end if;
    -- entrega direta sai pelo preço do pedido; demais saídas pelo custo médio
    new.custo_unitario := case when v_direta and new.custo_unitario is not null then new.custo_unitario else v_custo_atual end;
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

-- 2) Saída automática do recebimento ------------------------------------------------------
-- p = {destino_tipo, os_id, obra_id, centro_custo_id, colaborador_id}
create or replace function _entregar_direto(p_rec uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r     recebimentos_compra%rowtype;
  v_emp   uuid;
  v_dest  text := nullif(p->>'destino_tipo','');
  v_os    uuid := nullif(p->>'os_id','')::uuid;
  v_obra  uuid := nullif(p->>'obra_id','')::uuid;
  v_cc    uuid := nullif(p->>'centro_custo_id','')::uuid;
  v_col   uuid := nullif(p->>'colaborador_id','')::uuid;
  v_nome  text;
  v_vale  uuid;
  v_num   text;
  v_rot   text;
  it      record;
  v_mov   uuid;
  v_custo numeric(14,4);
  v_ins   uuid;
begin
  select * into v_r from recebimentos_compra where id = p_rec;
  v_emp := v_r.empresa_consultora_id;

  if v_dest = 'os' then
    select concat_ws(' · ', numero, titulo) into v_nome from ordens_servico where id = v_os and empresa_consultora_id = v_emp;
    if not found then raise exception 'Escolha a OS de destino'; end if;
    v_obra := null; v_cc := null;
  elsif v_dest = 'obra' then
    select coalesce(local, 'obra') into v_nome from obras_servicos where id = v_obra and empresa_consultora_id = v_emp;
    if not found then raise exception 'Escolha a obra de destino'; end if;
    v_os := null; v_cc := null;
  elsif v_dest = 'setor' then
    select nome into v_nome from centros_custo where id = v_cc and empresa_consultora_id = v_emp;
    if not found then raise exception 'Escolha o setor de destino'; end if;
    v_os := null; v_obra := null;
  else
    raise exception 'Destino da entrega direta inválido';
  end if;
  if v_col is not null and not exists (select 1 from colaboradores where id = v_col and empresa_consultora_id = v_emp) then
    raise exception 'Colaborador não encontrado';
  end if;

  -- só itens que entraram no estoque (patrimônio vira ferramenta e não sai aqui)
  if not exists (select 1 from recebimento_itens where recebimento_id = p_rec and movimentacao_id is not null) then
    return null;
  end if;

  v_num := proximo_numero('VS', 'vale_saida');
  insert into vales_almox (empresa_consultora_id, numero, tipo, deposito_id, colaborador_id, destino_tipo, os_id, obra_id,
                           centro_custo_id, nota_fiscal, observacao)
  values (v_emp, v_num, 'saida', v_r.deposito_id, v_col, v_dest, v_os, v_obra, v_cc, v_r.nota_fiscal,
          'Entrega direta do recebimento ' || v_r.numero)
  returning id into v_vale;
  v_rot := v_num || ' (entrega direta ' || v_r.numero || ')';

  for it in select ri.produto_id, ri.quantidade, ri.custo_unitario, p.nome
              from recebimento_itens ri join produtos p on p.id = ri.produto_id
             where ri.recebimento_id = p_rec and ri.movimentacao_id is not null
  loop
    v_ins := null;
    -- mesma convenção do balcão: obra → origem 'producao' com referência da obra (vw_custo_obra)
    insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, custo_unitario, origem, referencia_id, observacao)
    values (v_emp, it.produto_id, v_r.deposito_id, 'saida', it.quantidade, coalesce(it.custo_unitario, 0),
            case when v_obra is not null then 'producao' else 'vale' end, coalesce(v_obra, v_vale), v_rot)
    returning id, custo_unitario into v_mov, v_custo;
    if v_os is not null then
      insert into insumos_os (empresa_consultora_id, os_id, produto_id, descricao, quantidade, custo_unitario)
      values (v_emp, v_os, it.produto_id, it.nome || ' · ' || v_num, it.quantidade, round(coalesce(v_custo, 0), 2))
      returning id into v_ins;
    end if;
    insert into vale_itens (empresa_consultora_id, vale_id, produto_id, quantidade, custo_unitario, movimentacao_id, insumo_os_id)
    values (v_emp, v_vale, it.produto_id, it.quantidade, v_custo, v_mov, v_ins);
  end loop;

  update recebimentos_compra set vale_id = v_vale where id = p_rec;
  -- a tarefa "material chegou" deixa de mandar retirar no balcão
  update tarefas set descricao = 'Recebimento ' || v_r.numero || ' entregue direto em ' || v_nome || ' (vale ' || v_num || ').'
   where empresa_consultora_id = v_emp and automacao_chave = 'material:' || p_rec;
  return jsonb_build_object('id', v_vale, 'numero', v_num);
end $$;
revoke execute on function _entregar_direto(uuid, jsonb) from public, anon, authenticated;

-- 3) receber_pedido aceita o destino da entrega direta -------------------------------------
-- p = {pedido_id, deposito_id, data, nota_fiscal, observacao, anexo_caminho, anexo_nome, vencimento,
--      itens: [{item_id, quantidade, divergencia}],
--      destino_tipo?, os_id?, obra_id?, centro_custo_id?, colaborador_id?}   ← entrega direta
create or replace function receber_pedido(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ped    pedidos_compra%rowtype;
  v_rec    uuid;
  v_st     text;
  v_direta boolean := nullif(p->>'destino_tipo','') is not null;
  v_vale   jsonb;
begin
  if not pode('{compras,estoque}', 'editar') then raise exception 'Sem permissão para receber pedidos'; end if;
  select * into v_ped from pedidos_compra where id = (p->>'pedido_id')::uuid for update;
  if not found or v_ped.empresa_consultora_id <> auth_empresa_id() then raise exception 'Pedido não encontrado'; end if;
  if v_ped.status not in ('aberto','parcial') then raise exception 'Pedido % não pode mais ser recebido', v_ped.status; end if;

  if v_direta then perform set_config('app.entrega_direta', 'on', true); end if;
  v_rec := _receber_itens(v_ped, coalesce(nullif(p->>'deposito_id','')::uuid, v_ped.deposito_id),
                          nullif(p->>'data','')::date, p->>'nota_fiscal', p->>'observacao',
                          nullif(p->>'anexo_caminho',''), nullif(p->>'anexo_nome',''),
                          nullif(p->>'vencimento','')::date, p->'itens');
  if v_direta then
    v_vale := _entregar_direto(v_rec, p);
    perform set_config('app.entrega_direta', 'off', true);
  end if;

  v_st := _status_recebimento(v_ped.id);
  perform set_config('app.recebimento_rpc', 'on', true);
  update pedidos_compra set status = v_st,
         deposito_id = coalesce(deposito_id, nullif(p->>'deposito_id','')::uuid)
   where id = v_ped.id;
  return jsonb_build_object('id', v_rec, 'numero', (select numero from recebimentos_compra where id = v_rec), 'status', v_st,
                            'vale_id', v_vale->>'id', 'vale_numero', v_vale->>'numero');
end $$;
grant execute on function receber_pedido(jsonb) to authenticated;
