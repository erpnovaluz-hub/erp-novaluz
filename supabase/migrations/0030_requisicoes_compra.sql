-- =============================================================================
-- CRM/ERP NOVALUZ — 0030 REQUISIÇÕES DE COMPRA (etapa anterior ao pedido)
-- A requisição exige apenas item + quantidade. Preço e fornecedor são
-- opcionais (sugestão). A função gerar_pedido_de_requisicao() converte a
-- requisição num pedido de compra (0007), copiando os itens e definindo o
-- fornecedor escolhido no momento da conversão.
-- Depende de: 0007 (compras), 0009 (rls), 0004 (cadastros)
-- =============================================================================

create table if not exists requisicoes_compra (
  id                      uuid primary key default gen_random_uuid(),
  empresa_consultora_id   uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  numero                  text,
  solicitante             text,                                    -- quem solicitou
  fornecedor_sugerido_id  uuid references fornecedores(id),        -- opcional (sugestão)
  data                    date not null default current_date,
  status                  text not null default 'aberta'
                            check (status in ('aberta','convertida','cancelada')),
  pedido_id               uuid references pedidos_compra(id),      -- pedido gerado na conversão
  observacao              text
);

create table if not exists itens_requisicao_compra (
  id                      uuid primary key default gen_random_uuid(),
  empresa_consultora_id   uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  requisicao_id           uuid not null references requisicoes_compra(id) on delete cascade,
  produto_id              uuid not null references produtos(id),
  quantidade              numeric(14,3) not null check (quantidade > 0),
  custo_estimado          numeric(14,4)                            -- opcional (sugestão)
);

create index if not exists idx_reqcompra_tenant on requisicoes_compra(empresa_consultora_id, status);
create index if not exists idx_itensrc_requisicao on itens_requisicao_compra(requisicao_id);

-- RLS (mesmo padrão de 0009) -------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['requisicoes_compra','itens_requisicao_compra']
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

-- conversão: requisição -> pedido de compra ----------------------------------
-- Escolhe UM fornecedor no momento da conversão e gera 1 pedido com todos os
-- itens. custo_unitario do pedido = custo_estimado da requisição (ou 0).
create or replace function gerar_pedido_de_requisicao(
  p_requisicao_id uuid,
  p_fornecedor_id uuid,
  p_deposito_id   uuid  default null,
  p_categoria_id  uuid  default null,
  p_vencimento    date  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req      requisicoes_compra%rowtype;
  v_pedido   uuid;
  v_empresa  uuid := auth_empresa_id();
begin
  select * into v_req from requisicoes_compra where id = p_requisicao_id;
  if not found then
    raise exception 'Requisição não encontrada';
  end if;
  if v_req.empresa_consultora_id <> v_empresa then
    raise exception 'Requisição de outra empresa';
  end if;
  if v_req.status <> 'aberta' then
    raise exception 'Somente requisições abertas podem ser convertidas (status atual: %)', v_req.status;
  end if;
  if p_fornecedor_id is null then
    raise exception 'Escolha um fornecedor para gerar o pedido';
  end if;

  -- numero fica null: o trigger de pedidos_compra gera o PC-ANO-0001 próprio
  insert into pedidos_compra
    (empresa_consultora_id, numero, fornecedor_id, deposito_id, categoria_id, data, vencimento, status, observacao)
  values
    (v_empresa, null, p_fornecedor_id, p_deposito_id, p_categoria_id, current_date, p_vencimento, 'aberto',
     'Gerado da requisição ' || coalesce(v_req.numero, v_req.id::text)
       || case when v_req.observacao is not null then ' — ' || v_req.observacao else '' end)
  returning id into v_pedido;

  insert into itens_pedido_compra
    (empresa_consultora_id, pedido_id, produto_id, quantidade, custo_unitario)
  select v_empresa, v_pedido, produto_id, quantidade, coalesce(custo_estimado, 0)
    from itens_requisicao_compra
   where requisicao_id = p_requisicao_id;

  update requisicoes_compra
     set status = 'convertida', pedido_id = v_pedido
   where id = p_requisicao_id;

  return v_pedido;
end $$;

grant execute on function gerar_pedido_de_requisicao(uuid, uuid, uuid, uuid, date) to authenticated;

-- numeração automática (RC-ANO-0001) via trigger genérico do 0025 -------------
drop trigger if exists trg_num on requisicoes_compra;
create trigger trg_num before insert on requisicoes_compra
  for each row execute function set_numero_auto('RC', 'requisicao_compra');
