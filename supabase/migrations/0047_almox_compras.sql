-- =============================================================================
-- CRM/ERP NOVALUZ — 0047 Almoxarifado · Bloco 3: requisição × estoque × pedido
--
-- REQUISIÇÃO
--   ganha destino (OS/obra/setor) e criado_por; itens ganham quantidade_atendida
--   atender_requisicao(): o almoxarifado entrega o que tem → gera vale de saída
--   (registrar_vale) ligado à requisição. Status: aberta → atendida_parcial → atendida
--   Cotação/pedido gerados a partir dela passam a levar SÓ o que falta atender.
--
-- PEDIDO
--   itens ganham quantidade_recebida; status novo 'parcial'
--   receber_pedido(): conferência item a item, NF, foto da NF, divergências;
--     cada recebimento (RE-ANO-0001) dá entrada no estoque e gera 1 título a pagar
--     com o valor recebido; quem abriu a requisição recebe tarefa "material chegou"
--   encerrar_pedido(): fecha o saldo que o fornecedor não vai entregar
--   Mudar o status para 'recebido' pela tela antiga continua funcionando:
--     recebe tudo que falta, pelo mesmo caminho.
--
-- Depende de 0040, 0043 (tarefas automáticas), 0045 (_aplicar_acesso), 0046 (vales).
-- =============================================================================

-- 1) Requisição ------------------------------------------------------------------------
alter table requisicoes_compra add column if not exists criado_por      uuid references perfis(id) on delete set null default auth.uid();
alter table requisicoes_compra add column if not exists destino_tipo    text check (destino_tipo in ('os','obra','setor'));
alter table requisicoes_compra add column if not exists os_id           uuid references ordens_servico(id) on delete set null;
alter table requisicoes_compra add column if not exists obra_id         uuid references obras_servicos(id) on delete set null;
alter table requisicoes_compra add column if not exists centro_custo_id uuid references centros_custo(id) on delete set null;

alter table requisicoes_compra drop constraint if exists requisicoes_compra_status_check;
alter table requisicoes_compra add constraint requisicoes_compra_status_check
  check (status in ('aberta','atendida_parcial','atendida','convertida','cancelada'));

alter table itens_requisicao_compra add column if not exists quantidade_atendida numeric(14,3) not null default 0;

alter table vales_almox add column if not exists requisicao_id uuid references requisicoes_compra(id) on delete set null;
create index if not exists idx_vales_requisicao on vales_almox(requisicao_id) where requisicao_id is not null;

create or replace function atender_requisicao(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_req   requisicoes_compra%rowtype;
  it      jsonb;
  v_item  itens_requisicao_compra%rowtype;
  v_qtd   numeric(14,3);
  v_itens jsonb := '[]'::jsonb;
  v_vale  jsonb;
  v_pend  int;
begin
  if not pode('{estoque}', 'editar') then raise exception 'Sem permissão no módulo Estoque'; end if;
  select * into v_req from requisicoes_compra where id = (p->>'requisicao_id')::uuid for update;
  if not found or v_req.empresa_consultora_id <> auth_empresa_id() then raise exception 'Requisição não encontrada'; end if;
  if v_req.status not in ('aberta','atendida_parcial') then raise exception 'Requisição %: não dá mais para atender pelo estoque', v_req.status; end if;

  for it in select * from jsonb_array_elements(coalesce(p->'itens','[]'::jsonb)) loop
    v_qtd := nullif(it->>'quantidade','')::numeric;
    continue when v_qtd is null or v_qtd <= 0;
    select * into v_item from itens_requisicao_compra where id = (it->>'item_id')::uuid and requisicao_id = v_req.id for update;
    if not found then raise exception 'Item da requisição não encontrado'; end if;
    if v_qtd > v_item.quantidade - v_item.quantidade_atendida then
      raise exception 'Quantidade maior que o pendente do item (pendente: %)', v_item.quantidade - v_item.quantidade_atendida;
    end if;
    update itens_requisicao_compra set quantidade_atendida = quantidade_atendida + v_qtd where id = v_item.id;
    v_itens := v_itens || jsonb_build_object('produto_id', v_item.produto_id, 'quantidade', v_qtd);
  end loop;
  if jsonb_array_length(v_itens) = 0 then raise exception 'Informe a quantidade a entregar em pelo menos um item'; end if;

  -- o vale faz as checagens de saldo, retirante e destino
  v_vale := registrar_vale(jsonb_build_object(
    'tipo', 'saida', 'deposito_id', p->>'deposito_id', 'colaborador_id', p->>'colaborador_id',
    'destino_tipo', p->>'destino_tipo', 'os_id', p->>'os_id', 'obra_id', p->>'obra_id', 'centro_custo_id', p->>'centro_custo_id',
    'observacao', concat_ws(' · ', 'Atendimento da ' || coalesce(v_req.numero, 'requisição'), nullif(trim(p->>'observacao'), '')),
    'itens', v_itens));
  update vales_almox set requisicao_id = v_req.id where id = (v_vale->>'id')::uuid;

  select count(*) into v_pend from itens_requisicao_compra where requisicao_id = v_req.id and quantidade_atendida < quantidade;
  update requisicoes_compra set status = case when v_pend = 0 then 'atendida' else 'atendida_parcial' end where id = v_req.id;
  return v_vale;
end $$;
grant execute on function atender_requisicao(jsonb) to authenticated;

-- requisição fechada (atendida / convertida / cancelada) conclui a tarefa "Cotar …"
create or replace function _auto_requisicao_fechada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('convertida','cancelada','atendida') and old.status in ('aberta','atendida_parcial') then
    update tarefas set concluida = true
     where empresa_consultora_id = new.empresa_consultora_id and automacao_chave = 'requisicao:' || new.id and not concluida;
  end if;
  return new;
end $$;

-- conversões levam só o que falta atender
create or replace function gerar_pedido_de_requisicao(
  p_requisicao_id uuid, p_fornecedor_id uuid, p_deposito_id uuid default null,
  p_categoria_id uuid default null, p_vencimento date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_req      requisicoes_compra%rowtype;
  v_pedido   uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  if not pode('{compras}', 'editar') then raise exception 'Sem permissão no módulo Compras'; end if;
  select * into v_req from requisicoes_compra where id = p_requisicao_id;
  if not found then raise exception 'Requisição não encontrada'; end if;
  if v_req.empresa_consultora_id <> v_empresa then raise exception 'Requisição de outra empresa'; end if;
  if v_req.status not in ('aberta','atendida_parcial') then
    raise exception 'Somente requisições abertas podem ser convertidas (status atual: %)', v_req.status;
  end if;
  if p_fornecedor_id is null then raise exception 'Escolha um fornecedor para gerar o pedido'; end if;
  if not exists (select 1 from itens_requisicao_compra where requisicao_id = p_requisicao_id and quantidade > quantidade_atendida) then
    raise exception 'Nada a comprar: todos os itens já foram atendidos pelo estoque';
  end if;

  insert into pedidos_compra
    (empresa_consultora_id, numero, fornecedor_id, deposito_id, categoria_id, data, vencimento, status, observacao)
  values
    (v_empresa, null, p_fornecedor_id, p_deposito_id, p_categoria_id, current_date, p_vencimento, 'aberto',
     'Gerado da requisição ' || coalesce(v_req.numero, v_req.id::text)
       || case when v_req.observacao is not null then ' — ' || v_req.observacao else '' end)
  returning id into v_pedido;

  insert into itens_pedido_compra (empresa_consultora_id, pedido_id, produto_id, quantidade, custo_unitario)
  select v_empresa, v_pedido, produto_id, quantidade - quantidade_atendida, coalesce(custo_estimado, 0)
    from itens_requisicao_compra
   where requisicao_id = p_requisicao_id and quantidade > quantidade_atendida;

  update requisicoes_compra set status = 'convertida', pedido_id = v_pedido where id = p_requisicao_id;
  return v_pedido;
end $$;

create or replace function gerar_cotacao_de_requisicao(p_requisicao_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_req      requisicoes_compra%rowtype;
  v_cotacao  uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  if not pode('{compras}', 'editar') then raise exception 'Sem permissão no módulo Compras'; end if;
  select * into v_req from requisicoes_compra where id = p_requisicao_id;
  if not found then raise exception 'Requisição não encontrada'; end if;
  if v_req.empresa_consultora_id <> v_empresa then raise exception 'Requisição de outra empresa'; end if;
  if not exists (select 1 from itens_requisicao_compra where requisicao_id = p_requisicao_id and quantidade > quantidade_atendida) then
    raise exception 'Nada a cotar: todos os itens já foram atendidos pelo estoque';
  end if;

  insert into cotacoes_compra (empresa_consultora_id, numero, requisicao_id, data, status, observacao)
  values (v_empresa, null, p_requisicao_id, current_date, 'aberta',
          'Cotação da requisição ' || coalesce(v_req.numero, v_req.id::text))
  returning id into v_cotacao;

  insert into itens_cotacao (empresa_consultora_id, cotacao_id, produto_id, quantidade)
  select v_empresa, v_cotacao, produto_id, quantidade - quantidade_atendida
    from itens_requisicao_compra where requisicao_id = p_requisicao_id and quantidade > quantidade_atendida;

  if v_req.fornecedor_sugerido_id is not null then
    insert into cotacao_fornecedores (empresa_consultora_id, cotacao_id, fornecedor_id)
    values (v_empresa, v_cotacao, v_req.fornecedor_sugerido_id)
    on conflict do nothing;
  end if;
  return v_cotacao;
end $$;

-- a cotação decidida marca a requisição (aberta ou parcialmente atendida) como convertida
create or replace function gerar_pedido_de_cotacao(
  p_cotacao_id uuid, p_fornecedor_id uuid, p_deposito_id uuid default null,
  p_categoria_id uuid default null, p_vencimento date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cot      cotacoes_compra%rowtype;
  v_pedido   uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  if not pode('{compras}', 'editar') then raise exception 'Sem permissão no módulo Compras'; end if;
  select * into v_cot from cotacoes_compra where id = p_cotacao_id;
  if not found then raise exception 'Cotação não encontrada'; end if;
  if v_cot.empresa_consultora_id <> v_empresa then raise exception 'Cotação de outra empresa'; end if;
  if v_cot.status = 'cancelada' then raise exception 'Cotação cancelada'; end if;
  if p_fornecedor_id is null then raise exception 'Escolha o fornecedor vencedor'; end if;

  insert into pedidos_compra
    (empresa_consultora_id, numero, fornecedor_id, deposito_id, categoria_id, data, vencimento, status, observacao)
  values
    (v_empresa, null, p_fornecedor_id, p_deposito_id, p_categoria_id, current_date, p_vencimento, 'aberto',
     'Gerado da cotação ' || coalesce(v_cot.numero, v_cot.id::text))
  returning id into v_pedido;

  insert into itens_pedido_compra (empresa_consultora_id, pedido_id, produto_id, quantidade, custo_unitario)
  select v_empresa, v_pedido, ic.produto_id, ic.quantidade, coalesce(cp.preco_unitario, 0)
    from itens_cotacao ic
    left join cotacao_precos cp
      on cp.cotacao_id = ic.cotacao_id and cp.produto_id = ic.produto_id and cp.fornecedor_id = p_fornecedor_id
   where ic.cotacao_id = p_cotacao_id;

  update cotacoes_compra
     set status = 'decidida', fornecedor_vencedor_id = p_fornecedor_id, pedido_id = v_pedido
   where id = p_cotacao_id;

  if v_cot.requisicao_id is not null then
    update requisicoes_compra set status = 'convertida', pedido_id = v_pedido
     where id = v_cot.requisicao_id and status in ('aberta','atendida_parcial');
  end if;
  return v_pedido;
end $$;

-- 2) Pedido: recebimento parcial --------------------------------------------------------
alter table pedidos_compra drop constraint if exists pedidos_compra_status_check;
alter table pedidos_compra add constraint pedidos_compra_status_check
  check (status in ('aberto','parcial','recebido','cancelado'));

alter table itens_pedido_compra add column if not exists quantidade_recebida numeric(14,3) not null default 0;

create table if not exists recebimentos_compra (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  numero                text,
  pedido_id             uuid not null references pedidos_compra(id) on delete cascade,
  deposito_id           uuid not null references depositos(id),
  data                  date not null default current_date,
  nota_fiscal           text,
  observacao            text,
  anexo_caminho         text,                 -- foto/PDF da NF no bucket "anexos"
  anexo_nome            text,
  valor                 numeric(14,2) not null default 0,
  titulo_id             uuid references titulos_financeiros(id) on delete set null,
  recebido_por          uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);

create table if not exists recebimento_itens (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  recebimento_id        uuid not null references recebimentos_compra(id) on delete cascade,
  item_pedido_id        uuid references itens_pedido_compra(id) on delete set null,
  produto_id            uuid not null references produtos(id),
  quantidade            numeric(14,3) not null check (quantidade > 0),
  custo_unitario        numeric(14,4),
  divergencia           text,
  movimentacao_id       uuid references movimentacoes_estoque(id) on delete set null
);
create index if not exists idx_recebimentos_pedido on recebimentos_compra(pedido_id);
create index if not exists idx_recebimento_itens on recebimento_itens(recebimento_id);

-- leitura: compras e estoque; gravação só pelas rpcs
alter table recebimentos_compra enable row level security;
alter table recebimento_itens  enable row level security;
drop policy if exists recebimentos_ler on recebimentos_compra;
drop policy if exists recebimento_itens_ler on recebimento_itens;
create policy recebimentos_ler on recebimentos_compra for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select pode('{compras,estoque}'::text[], 'ver')));
create policy recebimento_itens_ler on recebimento_itens for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select pode('{compras,estoque}'::text[], 'ver')));

-- núcleo do recebimento (não mexe no status do pedido: quem chama decide)
-- p_itens = [{item_id, quantidade, divergencia}]
create or replace function _receber_itens(p_pedido pedidos_compra, p_deposito uuid, p_data date, p_nf text, p_obs text,
                                          p_anexo text, p_anexo_nome text, p_vencimento date, p_itens jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rec    uuid;
  v_num    text;
  it       jsonb;
  v_item   itens_pedido_compra%rowtype;
  v_qtd    numeric(14,3);
  v_mov    uuid;
  v_valor  numeric(14,2) := 0;
  v_tit    uuid;
  v_req    requisicoes_compra%rowtype;
  v_rot    text;
begin
  if p_deposito is null then raise exception 'Informe o depósito que recebe o material'; end if;
  v_num := proximo_numero('RE', 'recebimento');
  if v_num is null then   -- chamado sem usuário (ex.: SQL Editor): numera pela empresa do pedido
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

    insert into movimentacoes_estoque (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, custo_unitario, origem, referencia_id, observacao)
    values (p_pedido.empresa_consultora_id, v_item.produto_id, p_deposito, 'entrada', v_qtd, coalesce(v_item.custo_unitario, 0),
            'compra', p_pedido.id, 'Recebimento ' || v_rot)
    returning id into v_mov;

    update itens_pedido_compra set quantidade_recebida = quantidade_recebida + v_qtd where id = v_item.id;
    insert into recebimento_itens (empresa_consultora_id, recebimento_id, item_pedido_id, produto_id, quantidade, custo_unitario, divergencia, movimentacao_id)
    values (p_pedido.empresa_consultora_id, v_rec, v_item.id, v_item.produto_id, v_qtd, v_item.custo_unitario,
            nullif(trim(it->>'divergencia'), ''), v_mov);
    v_valor := v_valor + round(v_qtd * coalesce(v_item.custo_unitario, 0), 2);
  end loop;

  if not exists (select 1 from recebimento_itens where recebimento_id = v_rec) then
    raise exception 'Informe a quantidade recebida de pelo menos um item';
  end if;

  -- 1 título a pagar por recebimento, no valor do que chegou
  if v_valor > 0 then
    insert into titulos_financeiros (empresa_consultora_id, tipo, descricao, fornecedor_id, categoria_id, valor,
                                     vencimento, competencia, status, origem, referencia_id)
    values (p_pedido.empresa_consultora_id, 'pagar', 'Pedido de compra ' || v_rot, p_pedido.fornecedor_id, p_pedido.categoria_id,
            v_valor, coalesce(p_vencimento, p_pedido.vencimento, current_date), coalesce(p_data, current_date),
            'aberto', 'compra', p_pedido.id)
    returning id into v_tit;
  end if;
  update recebimentos_compra set valor = v_valor, titulo_id = v_tit where id = v_rec;

  -- avisa quem abriu a requisição de origem
  select * into v_req from requisicoes_compra where pedido_id = p_pedido.id and criado_por is not null limit 1;
  if found then
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

-- status conforme o que já chegou
create or replace function _status_recebimento(p_pedido uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from itens_pedido_compra where pedido_id = p_pedido and quantidade_recebida < quantidade) then 'recebido'
    when exists (select 1 from itens_pedido_compra where pedido_id = p_pedido and quantidade_recebida > 0) then 'parcial'
    else 'aberto' end
$$;

-- p = {pedido_id, deposito_id, data, nota_fiscal, observacao, anexo_caminho, anexo_nome, vencimento,
--      itens: [{item_id, quantidade, divergencia}]}
create or replace function receber_pedido(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ped  pedidos_compra%rowtype;
  v_rec  uuid;
  v_st   text;
begin
  if not pode('{compras,estoque}', 'editar') then raise exception 'Sem permissão para receber pedidos'; end if;
  select * into v_ped from pedidos_compra where id = (p->>'pedido_id')::uuid for update;
  if not found or v_ped.empresa_consultora_id <> auth_empresa_id() then raise exception 'Pedido não encontrado'; end if;
  if v_ped.status not in ('aberto','parcial') then raise exception 'Pedido % não pode mais ser recebido', v_ped.status; end if;

  v_rec := _receber_itens(v_ped, coalesce(nullif(p->>'deposito_id','')::uuid, v_ped.deposito_id),
                          nullif(p->>'data','')::date, p->>'nota_fiscal', p->>'observacao',
                          nullif(p->>'anexo_caminho',''), nullif(p->>'anexo_nome',''),
                          nullif(p->>'vencimento','')::date, p->'itens');

  v_st := _status_recebimento(v_ped.id);
  perform set_config('app.recebimento_rpc', 'on', true);
  update pedidos_compra set status = v_st,
         deposito_id = coalesce(deposito_id, nullif(p->>'deposito_id','')::uuid)
   where id = v_ped.id;
  return jsonb_build_object('id', v_rec, 'numero', (select numero from recebimentos_compra where id = v_rec), 'status', v_st);
end $$;
grant execute on function receber_pedido(jsonb) to authenticated;

-- fornecedor não vai entregar o resto: fecha o pedido sem receber o saldo
create or replace function encerrar_pedido(p_pedido uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ped pedidos_compra%rowtype;
begin
  if not pode('{compras}', 'editar') then raise exception 'Sem permissão no módulo Compras'; end if;
  select * into v_ped from pedidos_compra where id = p_pedido for update;
  if not found or v_ped.empresa_consultora_id <> auth_empresa_id() then raise exception 'Pedido não encontrado'; end if;
  if v_ped.status not in ('aberto','parcial') then raise exception 'Pedido já está %', v_ped.status; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'Informe o motivo'; end if;
  perform set_config('app.recebimento_rpc', 'on', true);
  update pedidos_compra
     set status = case when v_ped.status = 'aberto' then 'cancelado' else 'recebido' end,
         observacao = concat_ws(E'\n', observacao, 'Encerrado com saldo pendente em ' || to_char(current_date, 'DD/MM/YYYY') || ': ' || trim(p_motivo))
   where id = p_pedido;
end $$;
grant execute on function encerrar_pedido(uuid, text) to authenticated;

-- gatilho antigo: status → 'recebido' pela tela recebe tudo que falta (mesmo caminho)
create or replace function processar_recebimento_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_itens jsonb;
begin
  if current_setting('app.recebimento_rpc', true) = 'on' then return new; end if;
  if new.status <> 'recebido' or old.status not in ('aberto','parcial') then return new; end if;
  if coalesce(new.deposito_id, old.deposito_id) is null then
    raise exception 'Recebimento exige depósito de destino no pedido';
  end if;
  select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', quantidade - quantidade_recebida))
    into v_itens from itens_pedido_compra where pedido_id = new.id and quantidade > quantidade_recebida;
  if v_itens is not null then
    perform _receber_itens(new, coalesce(new.deposito_id, old.deposito_id), current_date, null,
                           'Recebimento total pela tela do pedido', null, null, new.vencimento, v_itens);
  end if;
  return new;
end $$;

-- total do pedido só recalcula quando muda quantidade/preço (não no recebimento;
-- senão o gatilho de status tentaria atualizar o próprio pedido no meio do update)
drop trigger if exists trg_total_pedido on itens_pedido_compra;
create trigger trg_total_pedido
  after insert or delete or update of quantidade, custo_unitario, pedido_id on itens_pedido_compra
  for each row execute function recalcular_total_pedido();

-- 3) Dados antigos -------------------------------------------------------------------------
-- pedidos já recebidos antes desta versão: itens contam como 100% recebidos
update itens_pedido_compra i set quantidade_recebida = i.quantidade
  from pedidos_compra p
 where p.id = i.pedido_id and p.status = 'recebido' and i.quantidade_recebida = 0;
