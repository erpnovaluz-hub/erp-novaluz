-- =============================================================================
-- CRM/ERP NOVALUZ — 0012 views de resumo (evita o teto de 1000 linhas do
-- PostgREST em somatórios; o app passa a ler totais já agregados no banco).
-- =============================================================================

create or replace view vw_titulos_resumo as
select
  empresa_consultora_id,
  tipo,
  status,
  sum(valor)  as total,
  count(*)    as qtd
from titulos_financeiros
group by empresa_consultora_id, tipo, status;

alter view vw_titulos_resumo set (security_invoker = on);
