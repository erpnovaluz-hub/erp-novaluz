-- =============================================================================
-- CRM/ERP NOVALUZ — 0052 OS 2.0 · Bloco 2: valor de venda, horas e margem
--
-- ordens_servico.valor_venda  quanto a OS vale para o cliente (só a gerência vê na tela)
-- os_apontamentos             horas por colaborador/dia (normal, extra 50%, extra 100%),
--                             opcionalmente ligadas a uma atividade
-- os_apontamento_custos       custo de cada apontamento com o custo/hora DO DIA
--                             (reajuste depois não muda OS antiga). Só a gerência lê:
--                             custo/hora vem do salário (RH).
-- resultado_os(id) / resultados_os()  venda × material × mão de obra × margem (gerência)
-- vw_os_resumo ganha horas_apontadas (sem valores; todos do módulo OS veem)
--
-- ATENÇÃO (SQL Editor do Supabase): sem "select ... into" — ver migration 0050.
-- Depende de 0016, 0040 (pode/is_gerente), 0045 (_aplicar_acesso), 0051.
-- =============================================================================

alter table ordens_servico add column if not exists valor_venda numeric(14,2);

create table if not exists os_apontamentos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  atividade_id          uuid references atividades_os(id) on delete set null,
  colaborador_id        uuid not null references colaboradores(id),
  data                  date not null default current_date,
  horas                 numeric(6,2) not null check (horas > 0 and horas <= 24),
  tipo                  text not null default 'normal' check (tipo in ('normal','extra50','extra100')),
  observacao            text,
  registrado_por        uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);
create index if not exists idx_apont_os on os_apontamentos(os_id, data desc);
create index if not exists idx_apont_colab on os_apontamentos(colaborador_id, data);
select _aplicar_acesso('os_apontamentos', '{os}', '{os}');

create table if not exists os_apontamento_custos (
  apontamento_id        uuid primary key references os_apontamentos(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id),
  custo_hora            numeric(14,2) not null default 0,
  custo                 numeric(14,2) not null default 0
);
alter table os_apontamento_custos enable row level security;
drop policy if exists apont_custos_gerencia on os_apontamento_custos;
create policy apont_custos_gerencia on os_apontamento_custos for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()));
-- sem policy de escrita: só o gatilho grava

create or replace function _apontamento_custo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ch   numeric := coalesce((select custo_hora from colaboradores where id = new.colaborador_id), 0);
  v_mult numeric := case new.tipo when 'extra50' then 1.5 when 'extra100' then 2 else 1 end;
begin
  insert into os_apontamento_custos (apontamento_id, empresa_consultora_id, custo_hora, custo)
  values (new.id, new.empresa_consultora_id, v_ch, round(new.horas * v_ch * v_mult, 2))
  -- na edição mantém o custo/hora do dia original; só recalcula horas/tipo
  on conflict (apontamento_id) do update
     set custo = round(new.horas * os_apontamento_custos.custo_hora * v_mult, 2);
  return new;
end $$;
drop trigger if exists trg_apontamento_custo on os_apontamentos;
create trigger trg_apontamento_custo after insert or update of horas, tipo on os_apontamentos
  for each row execute function _apontamento_custo();

-- resumo sem valores: progresso, atividades, horas (todos do módulo OS)
create or replace view vw_os_resumo as
select
  o.id as os_id,
  o.empresa_consultora_id,
  o.custo_estimado,
  coalesce(a.qtd, 0)         as atividades,
  coalesce(a.concluidas, 0)  as atividades_concluidas,
  coalesce(a.progresso, 0)   as progresso_pct,
  coalesce(i.custo, 0)       as custo_insumos,
  coalesce(h.horas, 0)       as horas_apontadas
from ordens_servico o
left join (
  select os_id, count(*) as qtd,
         count(*) filter (where status = 'concluido') as concluidas,
         round(avg(conclusao_pct), 1) as progresso
  from atividades_os group by os_id
) a on a.os_id = o.id
left join (select os_id, sum(custo_total) as custo from insumos_os group by os_id) i on i.os_id = o.id
left join (select os_id, sum(horas) as horas from os_apontamentos group by os_id) h on h.os_id = o.id;
alter view vw_os_resumo set (security_invoker = on);

-- resultado financeiro (só gerência) ---------------------------------------------------
create or replace function resultados_os()
returns table (os_id uuid, valor_venda numeric, custo_estimado numeric, custo_material numeric,
               horas numeric, custo_mao_obra numeric, custo_total numeric, margem numeric, margem_pct numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select o.id, o.valor_venda, o.custo_estimado,
           coalesce((select sum(i.custo_total) from insumos_os i where i.os_id = o.id), 0) as mat,
           coalesce((select sum(a.horas) from os_apontamentos a where a.os_id = o.id), 0) as hrs,
           coalesce((select sum(c.custo) from os_apontamento_custos c
                       join os_apontamentos a on a.id = c.apontamento_id where a.os_id = o.id), 0) as mo
      from ordens_servico o
     where o.empresa_consultora_id = auth_empresa_id() and is_gerente()
  )
  select id, valor_venda, custo_estimado, mat, hrs, mo, mat + mo,
         case when valor_venda is null then null else valor_venda - (mat + mo) end,
         case when coalesce(valor_venda, 0) = 0 then null else round((valor_venda - (mat + mo)) / valor_venda * 100, 1) end
    from base
$$;

create or replace function resultado_os(p_os uuid)
returns table (os_id uuid, valor_venda numeric, custo_estimado numeric, custo_material numeric,
               horas numeric, custo_mao_obra numeric, custo_total numeric, margem numeric, margem_pct numeric)
language sql stable security definer set search_path = public as $$
  select * from resultados_os() r where r.os_id = p_os
$$;

grant execute on function resultados_os() to authenticated;
grant execute on function resultado_os(uuid) to authenticated;
