-- =============================================================================
-- CRM/ERP NOVALUZ — 0016 ORDENS DE SERVIÇO (item 4)
-- OS (plano de ação) por cliente + atividades + insumos. Espelha PlanosAcao +
-- Atividades da planilha, com controle de atividades e insumos por OS.
-- =============================================================================

create table if not exists ordens_servico (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  cliente_id            uuid references clientes(id) on delete set null,
  titulo                text not null,
  motivo                text,
  local                 text,
  como_sera_feito       text,
  responsavel           text,
  prazo                 date,
  data_realizado        date,
  custo_estimado        numeric(14,2) not null default 0,
  urgencia              text check (urgencia in ('baixa','media','alta')),
  status                text not null default 'a_fazer' check (status in ('a_fazer','em_andamento','concluido','cancelado'))
);

create table if not exists atividades_os (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  descricao             text not null,
  colaborador_id        uuid references colaboradores(id) on delete set null,
  setor                 text,
  data_inicio           date,
  data_fim              date,
  status                text not null default 'nao_iniciado'
                          check (status in ('nao_iniciado','em_andamento','concluido','parado')),
  conclusao_pct         numeric(5,2) not null default 0,   -- 0..100
  alocacao_pct          numeric(5,2) not null default 100
);

create table if not exists insumos_os (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  produto_id            uuid references produtos(id) on delete set null,
  descricao             text not null,
  quantidade            numeric(14,3) not null default 1,
  custo_unitario        numeric(14,2) not null default 0,
  custo_total           numeric(16,2) generated always as (round((quantidade * custo_unitario)::numeric, 2)) stored
);

create index if not exists idx_os_cliente     on ordens_servico(empresa_consultora_id, cliente_id);
create index if not exists idx_os_status       on ordens_servico(empresa_consultora_id, status);
create index if not exists idx_atividades_os   on atividades_os(os_id);
create index if not exists idx_insumos_os      on insumos_os(os_id);

-- RLS
do $$
declare t text;
begin
  foreach t in array array['ordens_servico','atividades_os','insumos_os'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_all on %I;', t);
    execute format($f$
      create policy tenant_all on %I
        using (empresa_consultora_id = auth_empresa_id())
        with check (empresa_consultora_id = auth_empresa_id());
    $f$, t);
  end loop;
end $$;

-- VIEW: progresso e custo por OS (atividades + insumos)
create or replace view vw_os_resumo as
select
  o.id as os_id,
  o.empresa_consultora_id,
  o.custo_estimado,
  coalesce(a.qtd, 0)         as atividades,
  coalesce(a.concluidas, 0)  as atividades_concluidas,
  coalesce(a.progresso, 0)   as progresso_pct,
  coalesce(i.custo, 0)       as custo_insumos
from ordens_servico o
left join (
  select os_id, count(*) as qtd,
         count(*) filter (where status = 'concluido') as concluidas,
         round(avg(conclusao_pct), 1) as progresso
  from atividades_os group by os_id
) a on a.os_id = o.id
left join (
  select os_id, sum(custo_total) as custo from insumos_os group by os_id
) i on i.os_id = o.id;

alter view vw_os_resumo set (security_invoker = on);
