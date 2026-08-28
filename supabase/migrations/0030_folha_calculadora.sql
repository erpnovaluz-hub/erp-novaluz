-- =============================================================================
-- CRM/ERP NOVALUZ — 0030 FOLHA: calculadora (adiantamento + fechamento)
-- Guarda os dados de cálculo por lançamento: % de adiantamento, horas extras
-- (dia útil 63% e domingo 100%), bonificação, adicional, abono família e
-- descontos (horas + valor). Views recalculam adiantamento (dia 15) e
-- fechamento (último dia). Dois títulos a pagar por colaborador.
-- =============================================================================

-- 1) Campos de cálculo no lançamento ------------------------------------------
alter table folha_lancamentos
  add column if not exists pct_adiantamento      numeric(5,2)  not null default 40,
  add column if not exists he_util_horas         numeric(8,2)  not null default 0,   -- horas extras dia útil (63%)
  add column if not exists he_domingo_horas      numeric(8,2)  not null default 0,   -- horas extras domingo (100%)
  add column if not exists desc_horas            numeric(8,2)  not null default 0,   -- horas descontadas
  add column if not exists desc_valor            numeric(14,2) not null default 0,   -- outros descontos (R$)
  add column if not exists bonificacao           numeric(14,2) not null default 0,
  add column if not exists adicional             numeric(14,2) not null default 0,
  add column if not exists abono_familia         numeric(14,2) not null default 0,
  add column if not exists titulo_adiantamento_id uuid references titulos_financeiros(id) on delete set null,
  add column if not exists titulo_fechamento_id   uuid references titulos_financeiros(id) on delete set null;

-- 2) Views (recriadas — colunas mudam de posição) -----------------------------
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
  sum(adiantamento)                                     as adiantamentos,
  sum(fechamento)                                       as fechamentos,
  sum(custo_total)                                      as custo_total
from vw_folha_lancamento
group by empresa_consultora_id, competencia;

alter view vw_folha_lancamento set (security_invoker = on);
alter view vw_folha_mensal      set (security_invoker = on);
