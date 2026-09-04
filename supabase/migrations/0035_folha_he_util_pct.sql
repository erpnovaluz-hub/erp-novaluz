-- =============================================================================
-- CRM/ERP NOVALUZ — 0035 FOLHA: percentual da hora extra em dia útil
-- Permite escolher, por lançamento, se a hora extra em dia útil é 50% ou 63%.
-- O valor em R$ (horas_extras) já é gravado calculado; guardamos só o % usado
-- para recarregar o lançamento com o mesmo cálculo.
-- =============================================================================

alter table folha_lancamentos
  add column if not exists he_util_pct numeric(5,2) not null default 63;  -- 50 ou 63
