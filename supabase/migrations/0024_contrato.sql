-- =============================================================================
-- CRM/ERP NOVALUZ — 0024 contrato: cláusulas (objeto/condicoes/escopo já em 0019)
-- =============================================================================
alter table contratos
  add column if not exists clausulas text;
