-- =============================================================================
-- CRM/ERP NOVALUZ — 0038 FOLHA: adicional pago junto do adiantamento (dia 15)
-- Valor extra pago junto da quinzena (dia 15). Entra no total do mês e no
-- título de adiantamento, mas NÃO reduz o saldo de salário do fechamento.
-- =============================================================================

alter table folha_lancamentos
  add column if not exists adicional_dia15 numeric(14,2) not null default 0;
