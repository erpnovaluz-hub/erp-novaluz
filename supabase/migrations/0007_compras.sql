-- =============================================================================
-- CRM/ERP NOVALUZ — 0007 COMPRAS (pedido + itens + recebimento)
-- Receber o pedido (status -> recebido) gera:
--   1) entrada de estoque para cada item (alimenta saldo + custo médio)
--   2) um título financeiro a pagar para o fornecedor
-- Depende de: 0005 (estoque), 0006 (financeiro), 0004 (cadastros)
-- =============================================================================

create table if not exists pedidos_compra (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  numero                text,
  fornecedor_id         uuid not null references fornecedores(id),
  deposito_id           uuid references depositos(id),
  categoria_id          uuid references categorias_financeiras(id),
  data                  date not null default current_date,
  vencimento            date,
  valor_total           numeric(14,2) not null default 0,   -- mantido por trigger dos itens
  status                text not null default 'aberto' check (status in ('aberto','recebido','cancelado')),
  observacao            text
);

create table if not exists itens_pedido_compra (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  pedido_id             uuid not null references pedidos_compra(id) on delete cascade,
  produto_id            uuid not null references produtos(id),
  quantidade            numeric(14,3) not null check (quantidade > 0),
  custo_unitario        numeric(14,4) not null,
  subtotal              numeric(14,2) generated always as (round((quantidade * custo_unitario)::numeric, 2)) stored
);

create index if not exists idx_pedcompra_tenant on pedidos_compra(empresa_consultora_id, status);
create index if not exists idx_itenspc_pedido    on itens_pedido_compra(pedido_id);

-- recalcula o total do pedido a partir dos itens ------------------------------
create or replace function recalcular_total_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_pedido uuid;
begin
  v_pedido := coalesce(new.pedido_id, old.pedido_id);
  update pedidos_compra p
    set valor_total = coalesce((select sum(subtotal) from itens_pedido_compra where pedido_id = v_pedido), 0)
    where p.id = v_pedido;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_total_pedido on itens_pedido_compra;
create trigger trg_total_pedido
  after insert or update or delete on itens_pedido_compra
  for each row execute function recalcular_total_pedido();

-- recebimento -----------------------------------------------------------------
create or replace function processar_recebimento_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  it record;
  v_dep uuid;
begin
  if old.status = 'recebido' or new.status <> 'recebido' then
    return new;
  end if;
  if new.deposito_id is null then
    raise exception 'Recebimento exige depósito de destino no pedido';
  end if;
  v_dep := new.deposito_id;

  -- 1) entradas de estoque
  for it in select * from itens_pedido_compra where pedido_id = new.id loop
    insert into movimentacoes_estoque
      (empresa_consultora_id, produto_id, deposito_id, tipo, quantidade, custo_unitario, origem, referencia_id, observacao)
    values
      (new.empresa_consultora_id, it.produto_id, v_dep, 'entrada', it.quantidade, it.custo_unitario, 'compra', new.id,
       'Recebimento pedido ' || coalesce(new.numero, new.id::text));
  end loop;

  -- 2) título a pagar
  insert into titulos_financeiros
    (empresa_consultora_id, tipo, descricao, fornecedor_id, categoria_id, valor, vencimento, status, origem, referencia_id)
  values
    (new.empresa_consultora_id, 'pagar',
     'Pedido de compra ' || coalesce(new.numero, new.id::text),
     new.fornecedor_id, new.categoria_id, new.valor_total, new.vencimento, 'aberto', 'compra', new.id);

  return new;
end $$;

drop trigger if exists trg_receb_pedido on pedidos_compra;
create trigger trg_receb_pedido
  before update on pedidos_compra
  for each row execute function processar_recebimento_pedido();
