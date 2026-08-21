-- =============================================================================
-- CRM/ERP NOVALUZ — 0021 PRECIFICADOR (custos por categoria + margem + impostos)
-- Preço sugerido = (custo_direto + overhead) / (1 - margem% - impostos% - comissao% - taxa_cartao%)
-- Custo separado por categoria (material, mão de obra, equipamento, terceiro, frete, outros).
-- =============================================================================

alter table produtos
  add column if not exists categoria       text,
  add column if not exists tempo_horas      numeric(10,2) not null default 0,
  add column if not exists margem_alvo       numeric(6,2)  not null default 0,   -- % desejada
  add column if not exists preco_lista       numeric(14,2) not null default 0,
  add column if not exists custo_direto       numeric(14,2) not null default 0,  -- mantido por trigger
  add column if not exists preco_sugerido     numeric(14,2) not null default 0;  -- salvo pelo precificador

create table if not exists composicao_custo (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  produto_id            uuid not null references produtos(id) on delete cascade,
  categoria             text not null default 'material'
                          check (categoria in ('material','mao_de_obra','equipamento','terceiro','frete','outros')),
  descricao             text not null,
  quantidade            numeric(14,3) not null default 1,
  custo_unitario        numeric(14,4) not null default 0,
  custo_total           numeric(16,2) generated always as (round((quantidade * custo_unitario)::numeric, 2)) stored
);
create index if not exists idx_composicao_produto on composicao_custo(produto_id);

-- parâmetros de precificação (uma linha por tenant)
create table if not exists parametros_preco (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id() unique,
  overhead_metodo       text not null default 'hora' check (overhead_metodo in ('hora','percentual','nenhum')),
  overhead_hora         numeric(12,2) not null default 0,   -- R$/hora (método 'hora')
  overhead_perc         numeric(6,2)  not null default 0,   -- % sobre custo direto (método 'percentual')
  impostos_perc         numeric(6,2)  not null default 0,   -- % sobre o preço (Simples/ISS...)
  comissao_perc         numeric(6,2)  not null default 0,   -- % sobre o preço
  taxa_cartao_perc      numeric(6,2)  not null default 0,   -- % sobre o preço
  meta_faturamento      numeric(14,2) not null default 0
);

-- trigger: mantém produtos.custo_direto = soma da composição
create or replace function recalc_custo_direto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prod uuid;
begin
  v_prod := coalesce(new.produto_id, old.produto_id);
  update produtos p
    set custo_direto = coalesce((select sum(custo_total) from composicao_custo where produto_id = v_prod), 0)
    where p.id = v_prod;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_custo_direto on composicao_custo;
create trigger trg_custo_direto
  after insert or update or delete on composicao_custo
  for each row execute function recalc_custo_direto();

-- RLS
do $$
declare t text;
begin
  foreach t in array array['composicao_custo','parametros_preco'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;
