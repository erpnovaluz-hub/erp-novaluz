-- =============================================================================
-- CRM/ERP NOVALUZ — 0026 fluxo de caixa mensal a partir dos títulos financeiros
-- Conecta o fluxo ao financeiro: realizado (pago, por data de pagamento) e
-- previsto (em aberto, por vencimento), por mês.
-- =============================================================================
create or replace view vw_fluxo_mensal as
select
  empresa_consultora_id,
  date_trunc('month', case when status = 'pago' then data_pagamento else vencimento end)::date as mes,
  sum(case when tipo = 'receber' and status = 'pago'   then valor else 0 end) as entradas,
  sum(case when tipo = 'pagar'   and status = 'pago'   then valor else 0 end) as saidas,
  sum(case when tipo = 'receber' and status = 'aberto' then valor else 0 end) as a_receber,
  sum(case when tipo = 'pagar'   and status = 'aberto' then valor else 0 end) as a_pagar
from titulos_financeiros
where status <> 'cancelado'
  and (case when status = 'pago' then data_pagamento else vencimento end) is not null
group by 1, 2;

alter view vw_fluxo_mensal set (security_invoker = on);
