-- =============================================================================
-- CRM/ERP NOVALUZ — 0071 Ritmo de Gestão · Bloco 2: metas e KPIs
-- (spec: docs/ritmo-gestao/bloco2-spec.md)
--
-- Formato simples: indicador + meta + farol, por empresa, período = mês.
--   kpi_catalogo  → fichas globais (o que responde, fórmula, sentido, coleta),
--                   sugeridas por segmento da empresa
--   kpis          → os indicadores que cada empresa acompanha (meta nula =
--                   "medindo linha de base")
--   kpi_medicoes  → um valor por KPI por mês (+ a causa, quando fora da faixa)
--
-- Acesso: gerência vê e administra tudo; o responsável por um KPI vê só o
-- seu e lança valor/causa. KPIs financeiros só podem ter responsável da
-- gerência (almox/logística não veem valores — decisão da V3).
--
-- Cálculo automático: RPC kpi_atualizar(mês) — gerência. KPIs de "foto"
-- (recebíveis, caixa) só se medem no mês corrente; mês passado já gravado
-- não é sobrescrito.
--
-- Depende de 0006 (financeiro), 0041 (tarefas), 0051 (os_historico),
-- 0058 (resultados_os), 0070 (reuniões).
-- =============================================================================

-- 1) Segmento da empresa (só para sugerir o catálogo) -------------------------
alter table empresas_consultoras add column if not exists segmento text
  check (segmento in ('montagem_industrial','metalurgia','servicos','outro'));

create or replace function kpi_definir_segmento(p_segmento text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_gerente() then raise exception 'Somente a gerência define o segmento da empresa'; end if;
  update empresas_consultoras set segmento = p_segmento where id = auth_empresa_id();
end $$;
grant execute on function kpi_definir_segmento(text) to authenticated;

-- 2) Catálogo ---------------------------------------------------------------------
create table if not exists kpi_catalogo (
  chave       text primary key,
  nome        text not null,
  descricao   text not null,          -- a pergunta que ele responde
  decisao     text not null,          -- a decisão que ele apoia
  formula     text not null,
  unidade     text not null check (unidade in ('pct','brl','meses','numero','dias')),
  sentido     text not null check (sentido in ('maior','menor')),
  coleta      text not null check (coleta in ('automatico','manual')),
  foto        boolean not null default false,   -- estado no momento (não acumulado no mês)
  financeiro  boolean not null default false,   -- responsável precisa ser da gerência
  segmentos   text[] not null,                   -- 'comum' = todos
  aviso       text,
  ordem       int not null default 0
);
alter table kpi_catalogo enable row level security;
drop policy if exists kpi_catalogo_ler on kpi_catalogo;
create policy kpi_catalogo_ler on kpi_catalogo for select using (auth.uid() is not null);

insert into kpi_catalogo (chave, nome, descricao, decisao, formula, unidade, sentido, coleta, foto, financeiro, segmentos, aviso, ordem) values
 ('tarefas_no_prazo', 'Tarefas no prazo', 'As tarefas estão sendo entregues no prazo combinado?',
  'Sobrecarga ou mau planejamento: redistribuir carga ou rever prazos.',
  'Tarefas concluídas no mês até o prazo ÷ tarefas concluídas no mês que tinham prazo.',
  'pct', 'maior', 'automatico', false, false, '{comum}', null, 10),
 ('encaminhamentos_cumpridos', 'Encaminhamentos cumpridos', 'O que decidimos em reunião está acontecendo?',
  'Se cai, a reunião decide e ninguém executa: cobrar donos ou decidir menos e melhor.',
  'Encaminhamentos feitos no prazo ÷ encaminhamentos com prazo no mês já vencido ou feitos (exclui confidenciais e cancelados).',
  'pct', 'maior', 'automatico', false, false, '{comum}', null, 20),
 ('recebiveis_vencidos', 'Recebíveis vencidos', 'Quanto do que temos a receber já está atrasado?',
  'Apertar a cobrança e rever o crédito de clientes que atrasam.',
  'R$ a receber vencido ÷ R$ a receber em aberto (foto do mês).',
  'pct', 'menor', 'automatico', true, true, '{comum}', null, 30),
 ('caixa_meses', 'Caixa (meses de fôlego)', 'Por quantos meses o caixa paga as saídas atuais?',
  'Segurar ou liberar gasto e investimento.',
  'Saldo das contas ÷ média mensal das saídas dos últimos 90 dias (foto do mês).',
  'meses', 'maior', 'automatico', true, true, '{comum}', null, 40),
 ('os_no_prazo', 'OS entregues no prazo', 'As obras/pedidos estão sendo concluídos no prazo?',
  'Onde a operação atrasa: material, equipe, cliente — atacar a causa mais frequente.',
  'OS que passaram a "concluído" no mês até o prazo ÷ OS concluídas no mês que tinham prazo.',
  'pct', 'maior', 'automatico', false, false, '{montagem_industrial,metalurgia,servicos}', null, 50),
 ('margem_os', 'Margem média das OS', 'As OS estão dando o resultado esperado?',
  'Rever preço, escopo ou custo dos serviços com margem baixa.',
  'Média da margem % (venda − custo real) das OS concluídas no mês com valor de venda.',
  'pct', 'maior', 'automatico', false, true, '{metalurgia,servicos}',
  'Depende de apontamento de horas e insumos lançados na OS — sem eles a margem sai inflada.', 60),
 ('desvio_custo_os', 'Desvio de custo (previsto × real)', 'Estamos orçando certo?',
  'Corrigir a composição de custo do orçamento ou o controle na obra.',
  'Média de (custo real − custo estimado) ÷ custo estimado, nas OS concluídas no mês com custo estimado.',
  'pct', 'menor', 'automatico', false, true, '{montagem_industrial}',
  'Depende de apontamento de horas e insumos lançados na OS — sem eles o custo real sai baixo.', 70),
 ('dias_sem_acidente', 'Dias sem acidente', 'A operação está segura?',
  'Reforçar treinamento, EPI e procedimentos quando o contador zera.',
  'Dias corridos desde o último acidente com afastamento (lançado no fim do mês).',
  'dias', 'maior', 'manual', false, false, '{montagem_industrial,metalurgia}', null, 80),
 ('retrabalho', 'Retrabalho', 'Quanto estamos refazendo?',
  'Atacar a etapa/processo que mais gera retrabalho.',
  'Horas (ou peças) refeitas no mês, lançadas pelo responsável.',
  'numero', 'menor', 'manual', false, false, '{metalurgia}', null, 90),
 ('perda_material', 'Perda de material', 'Quanto material estamos desperdiçando?',
  'Rever corte/aproveitamento e armazenamento.',
  '% do material consumido que virou perda/sucata no mês, lançado pelo responsável.',
  'pct', 'menor', 'manual', false, false, '{metalurgia}', null, 100)
on conflict (chave) do update set
  nome = excluded.nome, descricao = excluded.descricao, decisao = excluded.decisao, formula = excluded.formula,
  unidade = excluded.unidade, sentido = excluded.sentido, coleta = excluded.coleta, foto = excluded.foto,
  financeiro = excluded.financeiro, segmentos = excluded.segmentos, aviso = excluded.aviso, ordem = excluded.ordem;

-- 3) KPIs da empresa -------------------------------------------------------------
create table if not exists kpis (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  catalogo_chave        text references kpi_catalogo(chave),
  nome                  text not null,
  descricao             text,
  unidade               text not null check (unidade in ('pct','brl','meses','numero','dias')),
  sentido               text not null check (sentido in ('maior','menor')),
  responsavel_id        uuid references perfis(id) on delete set null,
  meta                  numeric,                       -- nula = medindo linha de base
  tolerancia            numeric not null default 10 check (tolerancia >= 0 and tolerancia <= 100),
  ativo                 boolean not null default true,
  ordem                 int not null default 0,
  criado_por            uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);
create unique index if not exists uq_kpis_catalogo on kpis(empresa_consultora_id, catalogo_chave)
  where catalogo_chave is not null;
create index if not exists idx_kpis_responsavel on kpis(responsavel_id);

create table if not exists kpi_medicoes (
  kpi_id                uuid not null references kpis(id) on delete cascade,
  periodo               date not null check (extract(day from periodo) = 1),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  valor                 numeric,
  origem                text not null check (origem in ('automatico','manual')),
  observacao            text,
  registrado_por        uuid references perfis(id) on delete set null,
  atualizado_em         timestamptz not null default now(),
  primary key (kpi_id, periodo)
);

-- KPI financeiro: responsável precisa ser da gerência
create or replace function _kpi_valida()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_fin boolean;
begin
  select financeiro into v_fin from kpi_catalogo where chave = new.catalogo_chave;
  if coalesce(v_fin, false) and new.responsavel_id is not null
     and not exists (select 1 from perfis where id = new.responsavel_id and papel in ('super','admin')) then
    raise exception 'Indicador financeiro: o responsável precisa ser da gerência (almoxarifado e logística não veem valores)';
  end if;
  if new.responsavel_id is not null and not exists (
       select 1 from perfis where id = new.responsavel_id and empresa_consultora_id = new.empresa_consultora_id and ativo) then
    raise exception 'Responsável não encontrado na empresa';
  end if;
  return new;
end $$;
drop trigger if exists trg_kpi_valida on kpis;
create trigger trg_kpi_valida before insert or update on kpis
  for each row execute function _kpi_valida();

-- RLS: gerência tudo; responsável vê o seu. Escrita de medições só por RPC.
alter table kpis enable row level security;
drop policy if exists kpis_ler on kpis;
drop policy if exists kpis_gerir on kpis;
create policy kpis_ler on kpis for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and ((select is_gerente()) or responsavel_id = (select auth.uid())));
create policy kpis_gerir on kpis for all
  using      (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()))
  with check (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()));

alter table kpi_medicoes enable row level security;
drop policy if exists kpi_medicoes_ler on kpi_medicoes;
create policy kpi_medicoes_ler on kpi_medicoes for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and exists (select 1 from kpis k where k.id = kpi_id));   -- herda o RLS de kpis

-- 4) Cálculo automático --------------------------------------------------------------
-- Valor de um KPI automático no intervalo [inicio, fim]. Definer: filtra a empresa na mão.
create or replace function _kpi_valor_auto(p_chave text, p_emp uuid, p_inicio date, p_fim date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_num  numeric;
  v_den  numeric;
begin
  if p_chave = 'tarefas_no_prazo' then
    select count(*) filter (where (t.concluida_em at time zone 'America/Fortaleza')::date <= t.prazo), count(*)
      into v_num, v_den
      from tarefas t
     where t.empresa_consultora_id = p_emp and t.concluida and t.prazo is not null
       and (t.concluida_em at time zone 'America/Fortaleza')::date between p_inicio and p_fim;
    return case when v_den = 0 then null else round(v_num / v_den * 100, 1) end;

  elsif p_chave = 'encaminhamentos_cumpridos' then
    select count(*) filter (where e.status = 'feito_no_prazo'),
           count(*) filter (where e.status in ('feito_no_prazo','feito_atrasado','atrasado'))
      into v_num, v_den
      from vw_encaminhamentos e
     where e.empresa_consultora_id = p_emp and not e.reuniao_confidencial
       and e.prazo_efetivo between p_inicio and p_fim;
    return case when v_den = 0 then null else round(v_num / v_den * 100, 1) end;

  elsif p_chave = 'recebiveis_vencidos' then
    select coalesce(sum(valor) filter (where vencimento < v_hoje), 0), coalesce(sum(valor), 0)
      into v_num, v_den
      from titulos_financeiros
     where empresa_consultora_id = p_emp and tipo = 'receber' and status = 'aberto';
    return case when v_den = 0 then null else round(v_num / v_den * 100, 1) end;

  elsif p_chave = 'caixa_meses' then
    select coalesce(sum(saldo_atual), 0) into v_num from contas_bancarias where empresa_consultora_id = p_emp;
    select coalesce(sum(valor), 0) / 3 into v_den from movimentacoes_caixa
     where empresa_consultora_id = p_emp and tipo = 'debito' and data >= v_hoje - 90;
    return case when v_den = 0 then null else round(v_num / v_den, 1) end;

  elsif p_chave = 'os_no_prazo' then
    with conc as (
      select h.os_id, min(h.data) as quando
        from os_historico h
       where h.empresa_consultora_id = p_emp and h.para = 'concluido'
       group by h.os_id)
    select count(*) filter (where (c.quando at time zone 'America/Fortaleza')::date <= o.prazo), count(*)
      into v_num, v_den
      from conc c join ordens_servico o on o.id = c.os_id
     where o.prazo is not null and o.status in ('concluido','faturada')
       and (c.quando at time zone 'America/Fortaleza')::date between p_inicio and p_fim;
    return case when v_den = 0 then null else round(v_num / v_den * 100, 1) end;

  elsif p_chave in ('margem_os', 'desvio_custo_os') then
    -- mesmas contas de resultados_os() (0058), sem o filtro de sessão
    with conc as (
      select h.os_id, min(h.data) as quando
        from os_historico h
       where h.empresa_consultora_id = p_emp and h.para = 'concluido'
       group by h.os_id),
    base as (
      select o.valor_venda, o.custo_estimado,
             coalesce((select sum(i.custo_total) from insumos_os i where i.os_id = o.id), 0)
           + coalesce((select sum(c2.custo) from os_apontamento_custos c2
                         join os_apontamentos a on a.id = c2.apontamento_id where a.os_id = o.id), 0)
           + coalesce((select sum(t.custo_total) from os_servicos_terceiros t where t.os_id = o.id), 0) as custo
        from conc c join ordens_servico o on o.id = c.os_id
       where o.status in ('concluido','faturada')
         and (c.quando at time zone 'America/Fortaleza')::date between p_inicio and p_fim)
    select case when p_chave = 'margem_os'
             then round(avg((valor_venda - custo) / valor_venda * 100) filter (where coalesce(valor_venda, 0) > 0), 1)
             else round(avg((custo - custo_estimado) / custo_estimado * 100) filter (where coalesce(custo_estimado, 0) > 0), 1) end
      into v_num from base;
    return v_num;
  end if;
  return null;
end $$;
revoke all on function _kpi_valor_auto(text, uuid, date, date) from public, anon, authenticated;

-- Recalcula os KPIs automáticos ativos da empresa no mês (gerência).
create or replace function kpi_atualizar(p_periodo date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_emp    uuid := auth_empresa_id();
  v_ini    date := date_trunc('month', p_periodo)::date;
  v_fim    date := (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date;
  v_atual  date := date_trunc('month', (now() at time zone 'America/Fortaleza'))::date;
  k        record;
  v_n      int := 0;
begin
  if not is_gerente() then raise exception 'Somente a gerência atualiza os indicadores'; end if;
  if v_ini > v_atual then return 0; end if;
  for k in select kp.id, kp.catalogo_chave, c.foto
             from kpis kp join kpi_catalogo c on c.chave = kp.catalogo_chave
            where kp.empresa_consultora_id = v_emp and kp.ativo and c.coleta = 'automatico' loop
    -- foto (recebíveis, caixa): só no mês corrente; mês passado gravado fica congelado
    continue when k.foto and v_ini <> v_atual;
    insert into kpi_medicoes (kpi_id, periodo, empresa_consultora_id, valor, origem, registrado_por, atualizado_em)
    values (k.id, v_ini, v_emp, _kpi_valor_auto(k.catalogo_chave, v_emp, v_ini, v_fim), 'automatico', auth.uid(), now())
    on conflict (kpi_id, periodo) do update
      set valor = excluded.valor, atualizado_em = now(), registrado_por = excluded.registrado_por;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Lança valor (KPI manual) e/ou a causa (qualquer KPI). Gerência ou o responsável.
create or replace function kpi_lancar(p_kpi uuid, p_periodo date, p_valor numeric, p_observacao text)
returns void language plpgsql security definer set search_path = public as $$
declare
  k       kpis%rowtype;
  v_coleta text;
  v_ini   date := date_trunc('month', p_periodo)::date;
begin
  select * into k from kpis where id = p_kpi and empresa_consultora_id = auth_empresa_id();
  if k.id is null then raise exception 'Indicador não encontrado'; end if;
  if not (is_gerente() or k.responsavel_id = auth.uid()) then
    raise exception 'Só a gerência ou o responsável lançam este indicador';
  end if;
  if v_ini > date_trunc('month', (now() at time zone 'America/Fortaleza'))::date then
    raise exception 'Não dá para lançar um mês que ainda não começou';
  end if;
  select coalesce(c.coleta, 'manual') into v_coleta from (select 1) x
    left join kpi_catalogo c on c.chave = k.catalogo_chave;

  if v_coleta = 'automatico' then
    -- automático: só a causa; o valor é do sistema
    insert into kpi_medicoes (kpi_id, periodo, empresa_consultora_id, valor, origem, observacao, registrado_por)
    values (k.id, v_ini, k.empresa_consultora_id, null, 'automatico', nullif(trim(p_observacao), ''), auth.uid())
    on conflict (kpi_id, periodo) do update set observacao = excluded.observacao, atualizado_em = now();
  else
    insert into kpi_medicoes (kpi_id, periodo, empresa_consultora_id, valor, origem, observacao, registrado_por)
    values (k.id, v_ini, k.empresa_consultora_id, p_valor, 'manual', nullif(trim(p_observacao), ''), auth.uid())
    on conflict (kpi_id, periodo) do update
      set valor = excluded.valor, observacao = excluded.observacao,
          registrado_por = excluded.registrado_por, atualizado_em = now();
  end if;
end $$;

grant execute on function kpi_atualizar(date), kpi_lancar(uuid, date, numeric, text) to authenticated;
