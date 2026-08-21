-- =============================================================================
-- CRM/ERP NOVALUZ — 0013 subcategorias financeiras (2º nível abaixo da categoria)
-- categoria (com grupo_dre) -> subcategoria (detalhe). Título aponta para ambas.
-- =============================================================================

create table if not exists subcategorias_financeiras (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  categoria_id          uuid not null references categorias_financeiras(id) on delete cascade,
  nome                  text not null,
  ativo                 boolean not null default true
);

create unique index if not exists uq_subcategoria_nome
  on subcategorias_financeiras(empresa_consultora_id, categoria_id, nome);
create index if not exists idx_subcategoria_categoria
  on subcategorias_financeiras(categoria_id);

alter table titulos_financeiros
  add column if not exists subcategoria_id uuid references subcategorias_financeiras(id) on delete set null;

-- RLS
alter table subcategorias_financeiras enable row level security;
drop policy if exists tenant_all on subcategorias_financeiras;
create policy tenant_all on subcategorias_financeiras
  using      (empresa_consultora_id = auth_empresa_id())
  with check (empresa_consultora_id = auth_empresa_id());
