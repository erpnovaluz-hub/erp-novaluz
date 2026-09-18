-- =============================================================================
-- CRM/ERP NOVALUZ — 0039 Cenários do Simulador de Caixa
-- Guarda combinações salvas do simulador (títulos marcados + filtros).
-- Apenas metadados de simulação; não altera títulos nem saldos.
-- =============================================================================

create table if not exists simulacoes_caixa (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  usar_saldo            boolean not null default true,
  filtro_de             date,
  filtro_ate            date,
  titulo_ids            uuid[] not null default '{}',
  criado_por            uuid default auth.uid(),
  criado_em             timestamptz not null default now()
);

create index if not exists idx_simulacoes_caixa_empresa
  on simulacoes_caixa(empresa_consultora_id, criado_em desc);

alter table simulacoes_caixa enable row level security;
drop policy if exists tenant_all on simulacoes_caixa;
create policy tenant_all on simulacoes_caixa
  using      (empresa_consultora_id = auth_empresa_id())
  with check (empresa_consultora_id = auth_empresa_id());
