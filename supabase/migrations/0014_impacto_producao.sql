-- =============================================================================
-- CRM/ERP NOVALUZ — 0014 MÓDULO IMPACTO / PRODUÇÃO
-- Cadastro de peças (peso, valor/kg) + lançamentos de produção por cliente,
-- com peso e valor totais calculados. Base do controle específico Impacto.
-- =============================================================================

-- CADASTRO DE PEÇAS ------------------------------------------------------------
create table if not exists pecas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  peso                  numeric(12,3) not null default 0,   -- kg por unidade
  valor_kg              numeric(12,4) not null default 0,   -- R$/kg
  tipo                  text,                                -- LD | LP | LPP | ...
  ativo                 boolean not null default true
);
create unique index if not exists uq_peca_nome on pecas(empresa_consultora_id, nome);

-- LANÇAMENTOS DE PRODUÇÃO ------------------------------------------------------
create table if not exists producao (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  data                  date not null default current_date,
  cliente_id            uuid references clientes(id) on delete set null,
  colaborador_id        uuid references colaboradores(id) on delete set null,
  peca_id               uuid references pecas(id) on delete set null,
  peca_nome             text,
  categoria             text,
  tipo                  text,
  quantidade            numeric(14,3) not null default 0,
  peso_unit             numeric(12,3) not null default 0,
  valor_unit            numeric(12,4) not null default 0,    -- R$/kg da produção
  peso_total            numeric(16,3) generated always as (quantidade * peso_unit) stored,
  valor_total           numeric(16,2) generated always as (round((quantidade * peso_unit * valor_unit)::numeric, 2)) stored
);

create index if not exists idx_producao_cliente on producao(empresa_consultora_id, cliente_id);
create index if not exists idx_producao_data    on producao(empresa_consultora_id, data);
create index if not exists idx_producao_peca     on producao(peca_id);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['pecas','producao'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;

-- VIEW: resumo de produção por cliente (controle Impacto)
create or replace view vw_producao_cliente as
select
  p.empresa_consultora_id,
  p.cliente_id,
  c.nome as cliente,
  count(*)            as lancamentos,
  sum(p.quantidade)   as pecas,
  sum(p.peso_total)   as peso_total,
  sum(p.valor_total)  as valor_total
from producao p
left join clientes c on c.id = p.cliente_id
group by p.empresa_consultora_id, p.cliente_id, c.nome;

alter view vw_producao_cliente set (security_invoker = on);
