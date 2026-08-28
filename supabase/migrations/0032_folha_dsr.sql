-- =============================================================================
-- CRM/ERP NOVALUZ — 0032 FOLHA: DSR sobre faltas
-- Falta injustificada reflete no DSR (repouso semanal). Fórmula CLT:
--   DSR = (faltas ÷ dias úteis do mês) × (domingos + feriados) × salário-dia
-- Domingos e dias do mês vêm do calendário; feriados são informados por mês.
-- O valor calculado do DSR já entra na coluna "descontos" (R$) do lançamento.
-- =============================================================================

alter table folha_lancamentos
  add column if not exists feriados numeric(8,2) not null default 0;
