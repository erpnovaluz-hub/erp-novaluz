-- =============================================================================
-- CRM/ERP NOVALUZ — 0031 FOLHA: faltas
-- Falta em dias → desconto = dias × (salário ÷ 30), somado aos descontos.
-- Views recriadas para expor "faltas" (l.* captura colunas na criação).
-- =============================================================================

alter table folha_lancamentos
  add column if not exists faltas numeric(8,2) not null default 0;

drop view if exists vw_folha_mensal;
drop view if exists vw_folha_lancamento;

create view vw_folha_lancamento as
select x.*, (x.custo_total - x.adiantamento) as fechamento
from (
  select
    l.*,
    coalesce(b.total_beneficios, 0) as total_beneficios,
    round(l.salario_liquido / 220.0, 2) as valor_hora,
    (
      l.salario_liquido
      + l.horas_extras
      + coalesce(l.bonificacao, 0) + coalesce(l.adicional, 0) + coalesce(l.abono_familia, 0)
      + coalesce(b.total_beneficios, 0)
      - l.descontos
    ) as custo_total,
    round(l.salario_liquido * coalesce(l.pct_adiantamento, 40) / 100.0, 2) as adiantamento
  from folha_lancamentos l
  left join (
    select lancamento_id, sum(valor) as total_beneficios
    from folha_lancamento_beneficios
    group by lancamento_id
  ) b on b.lancamento_id = l.id
) x;

create view vw_folha_mensal as
select
  empresa_consultora_id,
  competencia,
  count(*)                                              as colaboradores,
  sum(salario_liquido)                                  as salarios,
  sum(total_beneficios)                                 as beneficios,
  sum(horas_extras)                                     as horas_extras,
  sum(coalesce(bonificacao,0) + coalesce(adicional,0) + coalesce(abono_familia,0)) as bonificacoes,
  sum(descontos)                                        as descontos,
  sum(coalesce(faltas,0))                               as faltas,
  sum(adiantamento)                                     as adiantamentos,
  sum(fechamento)                                       as fechamentos,
  sum(custo_total)                                      as custo_total
from vw_folha_lancamento
group by empresa_consultora_id, competencia;

alter view vw_folha_lancamento set (security_invoker = on);
alter view vw_folha_mensal      set (security_invoker = on);
