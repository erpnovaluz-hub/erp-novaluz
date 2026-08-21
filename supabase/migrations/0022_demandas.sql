-- =============================================================================
-- CRM/ERP NOVALUZ — 0022 DEMANDAS (painel de controle — foco Impacto)
-- Demandas que não são produção: quem pediu, o quê, data, valor, entrega,
-- responsável, status e motivo de bloqueio (por que não anda).
-- =============================================================================

create table if not exists demandas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid references clientes(id) on delete set null,
  titulo                text not null,
  descricao             text,
  solicitante           text,                      -- quem solicitou
  responsavel           text,                      -- responsável interno
  data_solicitacao      date not null default current_date,
  data_entrega_prevista date,
  data_entrega_real     date,
  valor_cobrado         numeric(14,2),
  prioridade            text check (prioridade in ('baixa','media','alta')),
  status                text not null default 'aberta'
                          check (status in ('aberta','em_andamento','bloqueada','concluida','cancelada')),
  bloqueio              text,                      -- motivo do bloqueio / por que não anda
  criado_em             timestamptz not null default now()
);

create index if not exists idx_demandas_cliente on demandas(empresa_consultora_id, cliente_id);
create index if not exists idx_demandas_status  on demandas(empresa_consultora_id, status);

alter table demandas enable row level security;
drop policy if exists tenant_all on demandas;
create policy tenant_all on demandas
  using (empresa_consultora_id = auth_empresa_id())
  with check (empresa_consultora_id = auth_empresa_id());
