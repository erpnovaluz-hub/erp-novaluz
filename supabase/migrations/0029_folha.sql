-- =============================================================================
-- CRM/ERP NOVALUZ — 0029 FOLHA DE PAGAMENTO
-- Controle mensal por colaborador: salário líquido, benefícios (detalhados por
-- tipo), horas extras e descontos. Um lançamento por colaborador por competência.
-- Integra com o financeiro: "gerar contas a pagar" cria títulos (origem='folha').
-- =============================================================================

-- 1) Colaborador ganha campos de folha (a tabela já existe desde 0002) ---------
alter table colaboradores add column if not exists cargo         text;
alter table colaboradores add column if not exists data_admissao date;
alter table colaboradores add column if not exists salario_base  numeric(14,2);

-- 2) Origem do título passa a aceitar 'folha' ---------------------------------
alter table titulos_financeiros drop constraint if exists titulos_financeiros_origem_check;
alter table titulos_financeiros add constraint titulos_financeiros_origem_check
  check (origem in ('manual','compra','contrato','faturamento','folha'));

-- 3) Tipos de benefício (configuráveis por empresa) ---------------------------
create table if not exists folha_tipos_beneficio (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  ativo                 boolean not null default true,
  ordem                 int not null default 0
);
create index if not exists idx_folha_tipoben_tenant on folha_tipos_beneficio(empresa_consultora_id);

-- 4) Lançamento da folha: 1 por colaborador por mês (competencia = dia 1) ------
create table if not exists folha_lancamentos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  colaborador_id        uuid not null references colaboradores(id) on delete cascade,
  competencia           date not null,                       -- sempre o dia 1 do mês
  salario_liquido       numeric(14,2) not null default 0,
  horas_extras          numeric(14,2) not null default 0,
  descontos             numeric(14,2) not null default 0,
  observacao            text,
  titulo_id             uuid references titulos_financeiros(id) on delete set null,
  criado_em             timestamptz not null default now(),
  unique (empresa_consultora_id, colaborador_id, competencia)
);
create index if not exists idx_folha_lanc_tenant on folha_lancamentos(empresa_consultora_id, competencia);
create index if not exists idx_folha_lanc_colab  on folha_lancamentos(colaborador_id);

-- 5) Valores de benefício por lançamento (detalhado por tipo) -----------------
create table if not exists folha_lancamento_beneficios (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  lancamento_id         uuid not null references folha_lancamentos(id) on delete cascade,
  tipo_beneficio_id     uuid not null references folha_tipos_beneficio(id) on delete restrict,
  valor                 numeric(14,2) not null default 0,
  unique (lancamento_id, tipo_beneficio_id)
);
create index if not exists idx_folha_lanben_lanc on folha_lancamento_beneficios(lancamento_id);

-- 6) Views ---------------------------------------------------------------------
-- custo_total = salário líquido + horas extras + benefícios − descontos
create or replace view vw_folha_lancamento as
select
  l.*,
  coalesce(b.total_beneficios, 0) as total_beneficios,
  l.salario_liquido + l.horas_extras + coalesce(b.total_beneficios, 0) - l.descontos as custo_total
from folha_lancamentos l
left join (
  select lancamento_id, sum(valor) as total_beneficios
  from folha_lancamento_beneficios
  group by lancamento_id
) b on b.lancamento_id = l.id;

create or replace view vw_folha_mensal as
select
  empresa_consultora_id,
  competencia,
  count(*)                as colaboradores,
  sum(salario_liquido)    as salarios,
  sum(total_beneficios)   as beneficios,
  sum(horas_extras)       as horas_extras,
  sum(descontos)          as descontos,
  sum(custo_total)        as custo_total
from vw_folha_lancamento
group by empresa_consultora_id, competencia;

alter view vw_folha_lancamento set (security_invoker = on);
alter view vw_folha_mensal      set (security_invoker = on);

-- 7) RLS -----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'folha_tipos_beneficio','folha_lancamentos','folha_lancamento_beneficios'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using      (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;

-- 8) Tipos de benefício padrão para empresas que ainda não têm nenhum ---------
do $$
declare e uuid;
begin
  for e in select id from empresas_consultoras loop
    if not exists (select 1 from folha_tipos_beneficio where empresa_consultora_id = e) then
      insert into folha_tipos_beneficio (empresa_consultora_id, nome, ordem) values
        (e, 'Vale-transporte', 1),
        (e, 'Vale-alimentação/refeição', 2),
        (e, 'Plano de saúde', 3);
    end if;
  end loop;
end $$;
