-- =============================================================================
-- CRM/ERP NOVALUZ — 0023 OS como obra + campos do painel de obras (TV)
-- =============================================================================
alter table ordens_servico
  add column if not exists is_obra     boolean not null default false,
  add column if not exists gargalos    text,   -- o que está travando / atenção
  add column if not exists orientacoes text;   -- principais cuidados / orientações
