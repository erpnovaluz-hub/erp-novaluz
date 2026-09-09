-- =============================================================================
-- CRM/ERP NOVALUZ — 0031 nomenclatura (REQ/COT/PED) + COTAÇÃO DE PREÇOS
-- Fluxo: Requisição (REQ) -> [opcional] Cotação (COT) -> Pedido (PED).
-- A cotação registra os preços de vários fornecedores para os mesmos itens;
-- escolhe-se UM fornecedor vencedor e gera-se 1 pedido com os preços dele.
-- Depende de: 0007 (compras), 0025 (numeração), 0030 (requisições)
-- =============================================================================

-- 1) NOMENCLATURA: novos prefixos de numeração -------------------------------
--    (números já gravados não mudam; só valem para novos registros)
drop trigger if exists trg_num on requisicoes_compra;
create trigger trg_num before insert on requisicoes_compra
  for each row execute function set_numero_auto('REQ', 'requisicao_compra');

drop trigger if exists trg_num on pedidos_compra;
create trigger trg_num before insert on pedidos_compra
  for each row execute function set_numero_auto('PED', 'pedido_compra');

-- 2) TABELAS DA COTAÇÃO ------------------------------------------------------
create table if not exists cotacoes_compra (
  id                      uuid primary key default gen_random_uuid(),
  empresa_consultora_id   uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  numero                  text,
  requisicao_id           uuid references requisicoes_compra(id),   -- origem (opcional)
  data                    date not null default current_date,
  status                  text not null default 'aberta'
                            check (status in ('aberta','decidida','cancelada')),
  fornecedor_vencedor_id  uuid references fornecedores(id),         -- definido ao decidir
  pedido_id               uuid references pedidos_compra(id),       -- pedido gerado
  observacao              text
);

-- itens a cotar (produto + quantidade)
create table if not exists itens_cotacao (
  id                      uuid primary key default gen_random_uuid(),
  empresa_consultora_id   uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cotacao_id              uuid not null references cotacoes_compra(id) on delete cascade,
  produto_id              uuid not null references produtos(id),
  quantidade              numeric(14,3) not null check (quantidade > 0)
);

-- fornecedores participantes da cotação
create table if not exists cotacao_fornecedores (
  id                      uuid primary key default gen_random_uuid(),
  empresa_consultora_id   uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cotacao_id              uuid not null references cotacoes_compra(id) on delete cascade,
  fornecedor_id           uuid not null references fornecedores(id),
  unique (cotacao_id, fornecedor_id)
);

-- preço unitário de cada item por fornecedor (matriz da cotação)
create table if not exists cotacao_precos (
  id                      uuid primary key default gen_random_uuid(),
  empresa_consultora_id   uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cotacao_id              uuid not null references cotacoes_compra(id) on delete cascade,
  produto_id              uuid not null references produtos(id),
  fornecedor_id           uuid not null references fornecedores(id),
  preco_unitario          numeric(14,4) not null check (preco_unitario >= 0),
  unique (cotacao_id, produto_id, fornecedor_id)
);

create index if not exists idx_cotacao_tenant   on cotacoes_compra(empresa_consultora_id, status);
create index if not exists idx_itenscot_cotacao on itens_cotacao(cotacao_id);
create index if not exists idx_cotforn_cotacao  on cotacao_fornecedores(cotacao_id);
create index if not exists idx_cotprec_cotacao  on cotacao_precos(cotacao_id);

-- numeração automática (COT-ANO-0001)
drop trigger if exists trg_num on cotacoes_compra;
create trigger trg_num before insert on cotacoes_compra
  for each row execute function set_numero_auto('COT', 'cotacao_compra');

-- 3) RLS (mesmo padrão de 0009) ----------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cotacoes_compra','itens_cotacao','cotacao_fornecedores','cotacao_precos']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using      (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;

-- 4) requisição -> cotação (copia os itens) ----------------------------------
create or replace function gerar_cotacao_de_requisicao(p_requisicao_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_req      requisicoes_compra%rowtype;
  v_cotacao  uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  select * into v_req from requisicoes_compra where id = p_requisicao_id;
  if not found then raise exception 'Requisição não encontrada'; end if;
  if v_req.empresa_consultora_id <> v_empresa then raise exception 'Requisição de outra empresa'; end if;

  insert into cotacoes_compra (empresa_consultora_id, numero, requisicao_id, data, status, observacao)
  values (v_empresa, null, p_requisicao_id, current_date, 'aberta',
          'Cotação da requisição ' || coalesce(v_req.numero, v_req.id::text))
  returning id into v_cotacao;

  insert into itens_cotacao (empresa_consultora_id, cotacao_id, produto_id, quantidade)
  select v_empresa, v_cotacao, produto_id, quantidade
    from itens_requisicao_compra where requisicao_id = p_requisicao_id;

  -- se a requisição sugeriu um fornecedor, já entra como participante
  if v_req.fornecedor_sugerido_id is not null then
    insert into cotacao_fornecedores (empresa_consultora_id, cotacao_id, fornecedor_id)
    values (v_empresa, v_cotacao, v_req.fornecedor_sugerido_id)
    on conflict do nothing;
  end if;

  return v_cotacao;
end $$;

-- 5) cotação -> pedido (usa os preços do fornecedor vencedor) -----------------
create or replace function gerar_pedido_de_cotacao(
  p_cotacao_id    uuid,
  p_fornecedor_id uuid,
  p_deposito_id   uuid  default null,
  p_categoria_id  uuid  default null,
  p_vencimento    date  default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_cot      cotacoes_compra%rowtype;
  v_pedido   uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  select * into v_cot from cotacoes_compra where id = p_cotacao_id;
  if not found then raise exception 'Cotação não encontrada'; end if;
  if v_cot.empresa_consultora_id <> v_empresa then raise exception 'Cotação de outra empresa'; end if;
  if v_cot.status = 'cancelada' then raise exception 'Cotação cancelada'; end if;
  if p_fornecedor_id is null then raise exception 'Escolha o fornecedor vencedor'; end if;

  -- numero null: o trigger de pedidos_compra gera o PED-ANO-0001
  insert into pedidos_compra
    (empresa_consultora_id, numero, fornecedor_id, deposito_id, categoria_id, data, vencimento, status, observacao)
  values
    (v_empresa, null, p_fornecedor_id, p_deposito_id, p_categoria_id, current_date, p_vencimento, 'aberto',
     'Gerado da cotação ' || coalesce(v_cot.numero, v_cot.id::text))
  returning id into v_pedido;

  -- copia itens usando o preço cotado do fornecedor vencedor (0 se não cotado)
  insert into itens_pedido_compra
    (empresa_consultora_id, pedido_id, produto_id, quantidade, custo_unitario)
  select v_empresa, v_pedido, ic.produto_id, ic.quantidade,
         coalesce(cp.preco_unitario, 0)
    from itens_cotacao ic
    left join cotacao_precos cp
      on cp.cotacao_id = ic.cotacao_id
     and cp.produto_id = ic.produto_id
     and cp.fornecedor_id = p_fornecedor_id
   where ic.cotacao_id = p_cotacao_id;

  update cotacoes_compra
     set status = 'decidida', fornecedor_vencedor_id = p_fornecedor_id, pedido_id = v_pedido
   where id = p_cotacao_id;

  -- marca a requisição de origem como convertida
  if v_cot.requisicao_id is not null then
    update requisicoes_compra
       set status = 'convertida', pedido_id = v_pedido
     where id = v_cot.requisicao_id and status = 'aberta';
  end if;

  return v_pedido;
end $$;

grant execute on function gerar_cotacao_de_requisicao(uuid) to authenticated;
grant execute on function gerar_pedido_de_cotacao(uuid, uuid, uuid, uuid, date) to authenticated;
