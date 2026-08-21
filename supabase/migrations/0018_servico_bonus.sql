-- =============================================================================
-- CRM/ERP NOVALUZ — 0018 marca serviços que contam para bônus
-- O bônus é calculado a partir da PRODUÇÃO, considerando apenas os lançamentos
-- cujo serviço tem conta_bonus = true (Limpeza+Preparação e Desamassar).
-- =============================================================================

alter table servicos add column if not exists conta_bonus boolean not null default false;

-- marca os dois serviços de bônus (por nome; ajuste depois se precisar)
update servicos set conta_bonus = true
  where nome ilike '%desamassar%' or nome ilike '%limpeza%prepara%';
