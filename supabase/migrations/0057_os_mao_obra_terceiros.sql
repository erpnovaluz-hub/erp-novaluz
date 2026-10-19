-- =============================================================================
-- CRM/ERP NOVALUZ — 0057 OS · mão de obra terceirizada (diária / hora)
--
-- Serviço contratado de fora usa o cadastro de produtos com tipo = 'servico'
-- (ex.: "Diária de soldador", unidade "diária"). Segue o fluxo normal:
--   requisição (destino OS) → cotação → pedido de compra → recebimento
-- No recebimento, item de serviço = diárias/horas executadas:
--   • não mexe no estoque (nem exige depósito)
--   • gera o título a pagar junto com o recebimento (como já era)
--   • lança o custo na OS em os_servicos_terceiros
-- OS do serviço: a informada no recebimento (flag app.servico_os) ou a da
-- requisição de origem. Sem OS → erro.
--
-- resultados_os()/resultado_os() ganham custo_terceiros (linha própria) e o
-- custo_total passa a somar material + mão de obra própria + terceiros.
--
-- ATENÇÃO (SQL Editor do Supabase): escalares por atribuição, sem "select ... into" — ver 0050.
-- Depende de 0047, 0048 (_receber_itens), 0052 (resultados_os), 0056 (receber_pedido).
-- =============================================================================

-- 1) Serviço não precisa de depósito -------------------------------------------------------
alter table recebimentos_compra alter column deposito_id drop not null;

-- 2) Custo de terceiros na OS --------------------------------------------------------------
create table if not exists os_servicos_terceiros (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  recebimento_id        uuid not null references recebimentos_compra(id) on delete cascade,
  pedido_id             uuid references pedidos_compra(id) on delete set null,
  fornecedor_id         uuid references fornecedores(id) on delete set null,
  produto_id            uuid not null references produtos(id),
  data                  date not null default current_date,
  quantidade            numeric(14,3) not null check (quantidade > 0),
  custo_unitario        numeric(14,4) not null default 0,
  custo_total           numeric(14,2) not null default 0,
  observacao            text,
  criado_em             timestamptz not null default now()
);
create index if not exists idx_os_terceiros_os on os_servicos_terceiros(os_id);

-- valores: só gerência lê; gravação só pelo recebimento
alter table os_servicos_terceiros enable row level security;
drop policy if exists os_terceiros_gerencia on os_servicos_terceiros;
create policy os_terceiros_gerencia on os_servicos_terceiros for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()));

-- 3) Recebimento: serviço vira custo da OS ---------------------------------------------------
create or replace function _receber_itens(p_pedido pedidos_compra, p_deposito uuid, p_data date, p_nf text, p_obs text,
                                          p_anexo text, p_anexo_nome text, p_vencimento date, p_itens jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rec    uuid;
  v_num    text;
  it       jsonb;
  v_item   itens_pedido_compra%rowtype;
  v_prod   produtos%rowtype;
  v_qtd    numeric(14,3);
  v_mov    uuid;
  v_valor  numeric(14,2) := 0;
  v_tit    uuid;
  v_req    requisicoes_compra%rowtype;
  v_rot    text;
  k        int;
  v_os     uuid := nullif(current_setting('app.servico_os', true), '')::uuid;
  v_mat    int := 0;
begin
  -- OS do serviço: a informada no recebimento ou a da requisição de origem
  v_os := coalesce(v_os, (select r.os_id from requisicoes_compra r
                           where r.pedido_id = p_pedido.id and r.destino_tipo = 'os' and r.os_id is not null limit 1));

  v_num := proximo_numero('RE', 'recebimento');
  if v_num is null then
    v_num := 'RE-' || extract(year from now())::int || '-' || substr(gen_random_uuid()::text, 1, 4);
  end if;
  v_rot := coalesce(p_pedido.numero, 'pedido') || coalesce(' · NF ' || nullif(trim(p_nf), ''), '') || ' (' || v_num || ')';

  insert into recebimentos_compra (empresa_consultora_id, numero, pedido_id, deposito_id, data, nota_fiscal, observacao, anexo_caminho, anexo_nome)
  values (p_pedido.empresa_consultora_id, v_num, p_pedido.id, p_deposito, coalesce(p_data, current_date),
          nullif(trim(p_nf), ''), nullif(trim(p_obs), ''), p_anexo, p_anexo_nome)
  returning id into v_rec;

  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    v_qtd := nullif(it->>'quantidade','')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_item from itens_pedido_compra where id = (it->>'item_id')::uuid and pedido_id = p_pedido.id for update;
    if not found then raise exception 'Item do pedido não encontrado'; end if;
    if v_qtd > v_item.quantidade - v_item.quantidade_recebida then
      raise exception 'Recebendo mais que o pendente do item (pendente: %). Registre a sobra como entrada avulsa.',
        v_item.quantidade - v_item.quantidade_recebida;
    end if;
    select * into v_prod from produtos where id = v_item.produto_id;
    v_mov := null;

    if v_prod.tipo = 'servico' then
      -- mão de obra terceirizada: diárias/horas executadas viram custo da OS
      if v_os is null then raise exception 'Informe a OS do serviço "%"', v_prod.nome; end if;
      insert into os_servicos_terceiros (empresa_consultora_id, os_id, recebimento_id, pedido_id, fornecedor_id, produto_id,
                                         data, quantidade, custo_unitario, custo_total, observacao)
      values (p_pedido.empresa_consultora_id, v_os, v_rec, p_pedido.id, p_pedido.fornecedor_id, v_prod.id,
              coalesce(p_data, current_date), v_qtd, coalesce(v_item.custo_unitario, 0),
              round(v_qtd * coalesce(v_item.custo_unitario, 0), 2), nullif(trim(it->>'divergencia'), ''));
    else
      if p_deposito is null then raise exception 'Informe o depósito que recebe o material'; end if;
      v_mat := v_mat + 1;
      if coalesce(v_prod.controla_patrimonio, false) then
        -- patrimônio: cada unidade vira uma ferramenta (não entra no saldo de estoque)
        if v_qtd <> trunc(v_qtd) then raise exception '"%" é patrimônio: a quantidade precisa ser inteira', v_prod.nome; end if;
        for k in 1 .. v_qtd::int loop
          insert into ferramentas (empresa_consultora_id, descricao, categoria, valor_aquisicao, data_aquisicao, fornecedor_id,
                                   pedido_id, produto_id, deposito_id, estado, observacao)
          values (p_pedido.empresa_consultora_id, v_prod.nome,
                  case when v_prod.secao = 'ferramentas' then 'ferramenta_eletrica' else 'equipamento' end,
                  v_item.custo_unitario, coalesce(p_data, current_date), p_pedido.fornecedor_id,
                  p_pedido.id, v_prod.id, p_deposito, 'novo', 'Recebimento ' || v_rot);
        end loop;
      else
        insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, custo_unitario, origem, referencia_id, observacao)
        values (p_pedido.empresa_consultora_id, v_item.produto_id, p_deposito, 'entrada', v_qtd, coalesce(v_item.custo_unitario, 0),
                'compra', p_pedido.id, 'Recebimento ' || v_rot)
        returning id into v_mov;
      end if;
    end if;

    update itens_pedido_compra set quantidade_recebida = quantidade_recebida + v_qtd where id = v_item.id;
    insert into recebimento_itens (empresa_consultora_id, recebimento_id, item_pedido_id, produto_id, quantidade, custo_unitario, divergencia, movimentacao_id)
    values (p_pedido.empresa_consultora_id, v_rec, v_item.id, v_item.produto_id, v_qtd, v_item.custo_unitario,
            nullif(trim(it->>'divergencia'), ''), v_mov);
    v_valor := v_valor + round(v_qtd * coalesce(v_item.custo_unitario, 0), 2);
  end loop;

  if not exists (select 1 from recebimento_itens where recebimento_id = v_rec) then
    raise exception 'Informe a quantidade recebida de pelo menos um item';
  end if;

  if v_valor > 0 then
    insert into titulos_financeiros (empresa_consultora_id, tipo, descricao, fornecedor_id, categoria_id, valor,
                                     vencimento, competencia, status, origem, referencia_id)
    values (p_pedido.empresa_consultora_id, 'pagar', 'Pedido de compra ' || v_rot, p_pedido.fornecedor_id, p_pedido.categoria_id,
            v_valor, coalesce(p_vencimento, p_pedido.vencimento, current_date), coalesce(p_data, current_date),
            'aberto', 'compra', p_pedido.id)
    returning id into v_tit;
  end if;
  update recebimentos_compra set valor = v_valor, titulo_id = v_tit where id = v_rec;

  -- avisa quem abriu a requisição (só quando chegou material para retirar)
  select * into v_req from requisicoes_compra where pedido_id = p_pedido.id and criado_por is not null limit 1;
  if found and v_mat > 0 then
    insert into tarefas (empresa_consultora_id, titulo, descricao, responsavel_id, prazo, prioridade, ordem,
                         vinculo_tipo, vinculo_id, vinculo_rotulo, origem, automacao_chave)
    values (p_pedido.empresa_consultora_id,
            'Material chegou: ' || coalesce(v_req.numero, 'requisição') || ' (' || coalesce(p_pedido.numero, 'pedido') || ')',
            'Recebimento ' || v_num || ' no almoxarifado. Retirar no balcão.',
            v_req.criado_por, current_date, 'media', extract(epoch from now()) * 1000,
            'requisicao', v_req.id, concat_ws(' · ', v_req.numero, v_req.observacao), 'automacao', 'material:' || v_rec);
  end if;
  return v_rec;
end $$;
revoke execute on function _receber_itens(pedidos_compra, uuid, date, text, text, text, text, date, jsonb) from public, anon, authenticated;

-- 4) receber_pedido: aceita a OS do serviço ----------------------------------------------------
-- p = {... como em 0056 ..., servico_os_id?}
create or replace function receber_pedido(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ped    pedidos_compra%rowtype;
  v_rec    uuid;
  v_st     text;
  v_direta boolean := nullif(p->>'destino_tipo','') is not null;
  v_vale   jsonb;
  v_os     uuid := nullif(p->>'servico_os_id','')::uuid;
begin
  if not pode('{compras,estoque}', 'editar') then raise exception 'Sem permissão para receber pedidos'; end if;
  select * into v_ped from pedidos_compra where id = (p->>'pedido_id')::uuid for update;
  if not found or v_ped.empresa_consultora_id <> auth_empresa_id() then raise exception 'Pedido não encontrado'; end if;
  if v_ped.status not in ('aberto','parcial') then raise exception 'Pedido % não pode mais ser recebido', v_ped.status; end if;
  if v_os is not null and not exists (select 1 from ordens_servico where id = v_os and empresa_consultora_id = v_ped.empresa_consultora_id) then
    raise exception 'OS do serviço não encontrada';
  end if;

  perform set_config('app.servico_os', coalesce(v_os::text, ''), true);
  if v_direta then perform set_config('app.entrega_direta', 'on', true); end if;
  v_rec := _receber_itens(v_ped, coalesce(nullif(p->>'deposito_id','')::uuid, v_ped.deposito_id),
                          nullif(p->>'data','')::date, p->>'nota_fiscal', p->>'observacao',
                          nullif(p->>'anexo_caminho',''), nullif(p->>'anexo_nome',''),
                          nullif(p->>'vencimento','')::date, p->'itens');
  perform set_config('app.servico_os', '', true);
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

-- 5) Resultado da OS com terceiros -------------------------------------------------------------
drop function if exists resultado_os(uuid);
drop function if exists resultados_os();

create function resultados_os()
returns table (os_id uuid, valor_venda numeric, custo_estimado numeric, custo_material numeric,
               horas numeric, custo_mao_obra numeric, custo_total numeric, margem numeric, margem_pct numeric,
               custo_terceiros numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select o.id, o.valor_venda, o.custo_estimado,
           coalesce((select sum(i.custo_total) from insumos_os i where i.os_id = o.id), 0) as mat,
           coalesce((select sum(a.horas) from os_apontamentos a where a.os_id = o.id), 0) as hrs,
           coalesce((select sum(c.custo) from os_apontamento_custos c
                       join os_apontamentos a on a.id = c.apontamento_id where a.os_id = o.id), 0) as mo,
           coalesce((select sum(t.custo_total) from os_servicos_terceiros t where t.os_id = o.id), 0) as ter
      from ordens_servico o
     where o.empresa_consultora_id = auth_empresa_id() and is_gerente()
  )
  select id, valor_venda, custo_estimado, mat, hrs, mo, mat + mo + ter,
         case when valor_venda is null then null else valor_venda - (mat + mo + ter) end,
         case when coalesce(valor_venda, 0) = 0 then null else round((valor_venda - (mat + mo + ter)) / valor_venda * 100, 1) end,
         ter
    from base
$$;

create function resultado_os(p_os uuid)
returns table (os_id uuid, valor_venda numeric, custo_estimado numeric, custo_material numeric,
               horas numeric, custo_mao_obra numeric, custo_total numeric, margem numeric, margem_pct numeric,
               custo_terceiros numeric)
language sql stable security definer set search_path = public as $$
  select * from resultados_os() r where r.os_id = p_os
$$;

grant execute on function resultados_os() to authenticated;
grant execute on function resultado_os(uuid) to authenticated;
