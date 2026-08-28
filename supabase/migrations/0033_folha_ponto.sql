-- =============================================================================
-- CRM/ERP NOVALUZ — 0033 FOLHA: apontamento diário (ponto) + benefício por dia
-- Calendário do mês por colaborador (presente/falta/atestado/feriado/folga).
-- Faltas e feriados passam a ser CONTADOS pelo apontamento.
-- Benefício ganha modo: 'diario' (valor/dia × dias presentes) ou 'fixo' (mês).
-- =============================================================================

-- 1) Apontamento diário no lançamento (mapa "yyyy-mm-dd" -> status) ------------
alter table folha_lancamentos
  add column if not exists ponto jsonb not null default '{}'::jsonb;

-- 2) Modo do tipo de benefício ------------------------------------------------
alter table folha_tipos_beneficio
  add column if not exists modo text not null default 'diario';

do $$
begin
  alter table folha_tipos_beneficio
    add constraint folha_tipos_beneficio_modo_check check (modo in ('diario','fixo'));
exception when duplicate_object then null;
end $$;

-- Plano de saúde é fixo no mês (não por dia)
update folha_tipos_beneficio
   set modo = 'fixo'
 where modo <> 'fixo'
   and (nome ilike '%saúde%' or nome ilike '%saude%' or nome ilike '%plano%');

-- 3) Valor-base do benefício (o que o usuário digita: por dia ou mensal) -------
--    "valor" continua sendo o TOTAL (usado nas views); valor_base é a entrada.
alter table folha_lancamento_beneficios
  add column if not exists valor_base numeric(14,2) not null default 0;

update folha_lancamento_beneficios
   set valor_base = valor
 where valor_base = 0 and valor <> 0;
