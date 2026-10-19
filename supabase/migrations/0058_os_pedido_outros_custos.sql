-- =============================================================================
-- CRM/ERP NOVALUZ — 0058 OS · pedido com OS + "outros custos"
--
-- 1) produtos.custo_os  (só para tipo 'servico'): 'mao_obra' | 'outros'
--    Diária de soldador → mão de obra terceirizada; frete, aluguel de
--    equipamento, hospedagem → outros custos da OS.
-- 2) pedidos_compra.os_id  OS do pedido. Preenchida sozinha quando o pedido
--    nasce de uma requisição (direto ou via cotação) com destino OS; também
--    pode ser escolhida no cadastro do pedido. No recebimento, a OS do serviço
--    é: a informada na tela → a do pedido → a da requisição.
-- 3) resultados_os()/resultado_os() ganham custo_outros; custo_terceiros fica
--    só com mão de obra; custo_total soma tudo.
--
-- ATENÇÃO (SQL Editor do Supabase): escalares por atribuição, sem "select ... into" — ver 0050.
-- Depende de 0057.
-- =============================================================================

-- 1) Categoria do custo do serviço ---------------------------------------------------------
alter table produtos add column if not exists custo_os text not null default 'mao_obra';
alter table produtos drop constraint if exists produtos_custo_os_check;
alter table produtos add constraint produtos_custo_os_check check (custo_os in ('mao_obra','outros'));

alter table os_servicos_terceiros add column if not exists categoria text not null default 'mao_obra';
alter table os_servicos_terceiros drop constraint if exists os_servicos_terceiros_categoria_check;
alter table os_servicos_terceiros add constraint os_servicos_terceiros_categoria_check check (categoria in ('mao_obra','outros'));

-- 2) OS no pedido ----------------------------------------------------------------------------
alter table pedidos_compra add column if not exists os_id uuid references ordens_servico(id) on delete set null;
create index if not exists idx_pedidos_os on pedidos_compra(os_id) where os_id is not null;

-- requisição convertida (pedido_id preenchido) leva a OS para o pedido
create or replace function _pedido_herda_os()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pedido_id is not null and new.pedido_id is distinct from old.pedido_id
     and new.destino_tipo = 'os' and new.os_id is not null then
    update pedidos_compra set os_id = new.os_id where id = new.pedido_id and os_id is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_pedido_herda_os on requisicoes_compra;
create trigger trg_pedido_herda_os after update of pedido_id on requisicoes_compra
  for each row execute function _pedido_herda_os();

-- pedidos já existentes
update pedidos_compra p set os_id = r.os_id
  from requisicoes_compra r
 where r.pedido_id = p.id and r.destino_tipo = 'os' and r.os_id is not null and p.os_id is null;

-- 3) Recebimento: OS do pedido + categoria do custo ------------------------------------------
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
  -- OS do serviço: a informada no recebimento → a do pedido → a da requisição de origem
  v_os := coalesce(v_os, p_pedido.os_id,
                   (select r.os_id from requisicoes_compra r
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
      -- serviço de terceiro: quantidade executada vira custo da OS (mão de obra ou outros custos)
      if v_os is null then raise exception 'Informe a OS do serviço "%"', v_prod.nome; end if;
      insert into os_servicos_terceiros (empresa_consultora_id, os_id, recebimento_id, pedido_id, fornecedor_id, produto_id,
                                         data, quantidade, custo_unitario, custo_total, observacao, categoria)
      values (p_pedido.empresa_consultora_id, v_os, v_rec, p_pedido.id, p_pedido.fornecedor_id, v_prod.id,
              coalesce(p_data, current_date), v_qtd, coalesce(v_item.custo_unitario, 0),
              round(v_qtd * coalesce(v_item.custo_unitario, 0), 2), nullif(trim(it->>'divergencia'), ''),
              coalesce(v_prod.custo_os, 'mao_obra'));
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

-- 4) Resultado da OS com "outros custos" -----------------------------------------------------
drop function if exists resultado_os(uuid);
drop function if exists resultados_os();

create function resultados_os()
returns table (os_id uuid, valor_venda numeric, custo_estimado numeric, custo_material numeric,
               horas numeric, custo_mao_obra numeric, custo_total numeric, margem numeric, margem_pct numeric,
               custo_terceiros numeric, custo_outros numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select o.id, o.valor_venda, o.custo_estimado,
           coalesce((select sum(i.custo_total) from insumos_os i where i.os_id = o.id), 0) as mat,
           coalesce((select sum(a.horas) from os_apontamentos a where a.os_id = o.id), 0) as hrs,
           coalesce((select sum(c.custo) from os_apontamento_custos c
                       join os_apontamentos a on a.id = c.apontamento_id where a.os_id = o.id), 0) as mo,
           coalesce((select sum(t.custo_total) from os_servicos_terceiros t where t.os_id = o.id and t.categoria = 'mao_obra'), 0) as ter,
           coalesce((select sum(t.custo_total) from os_servicos_terceiros t where t.os_id = o.id and t.categoria = 'outros'), 0) as outr
      from ordens_servico o
     where o.empresa_consultora_id = auth_empresa_id() and is_gerente()
  )
  select id, valor_venda, custo_estimado, mat, hrs, mo, mat + mo + ter + outr,
         case when valor_venda is null then null else valor_venda - (mat + mo + ter + outr) end,
         case when coalesce(valor_venda, 0) = 0 then null else round((valor_venda - (mat + mo + ter + outr)) / valor_venda * 100, 1) end,
         ter, outr
    from base
$$;

create function resultado_os(p_os uuid)
returns table (os_id uuid, valor_venda numeric, custo_estimado numeric, custo_material numeric,
               horas numeric, custo_mao_obra numeric, custo_total numeric, margem numeric, margem_pct numeric,
               custo_terceiros numeric, custo_outros numeric)
language sql stable security definer set search_path = public as $$
  select * from resultados_os() r where r.os_id = p_os
$$;

grant execute on function resultados_os() to authenticated;
grant execute on function resultado_os(uuid) to authenticated;
