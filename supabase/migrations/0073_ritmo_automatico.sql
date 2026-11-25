-- =============================================================================
-- CRM/ERP NOVALUZ — 0073 Ritmo de Gestão · Bloco 4: ritmo automático
-- (spec: docs/ritmo-gestao/bloco4-spec.md)
--
-- Tudo em SQL + pg_cron (sem servidor do app, sem IA):
--   ritmo_cron_reunioes()  07:00 Fortaleza — cria a próxima reunião de cada
--                          molde recorrente (convites, anterior ligada, pauta
--                          com adiados + indicadores fora da faixa) e
--                          sincroniza adiados de atas fechadas depois
--   ritmo_cron_lembretes() 16:00 — véspera (participantes), sugestões
--                          pendentes e ata não fechada (quem conduz, até 3x)
--   ritmo_cron_kpis()      23:30 — recalcula os KPIs automáticos de todas as
--                          empresas (a do último dia grava a foto do mês)
-- Idempotentes: rodar duas vezes não duplica reunião nem aviso.
-- Molde confidencial não existe (confidencial é sempre criada à mão).
--
-- Depende de 0061 (pg_cron), 0070 (reuniões), 0071 (KPIs).
-- =============================================================================

-- 0) Ajustes em tabelas existentes ---------------------------------------------
alter table reuniao_pauta drop constraint if exists reuniao_pauta_origem_check;
alter table reuniao_pauta add constraint reuniao_pauta_origem_check
  check (origem in ('manual','sugestao','pendencia','indicador'));

alter table reunioes add column if not exists lembrete_em      timestamptz;          -- véspera já avisada
alter table reunioes add column if not exists lembrete_ata_em  timestamptz;          -- último aviso de ata aberta
alter table reunioes add column if not exists lembretes_ata    int not null default 0;

-- 1) Moldes recorrentes -----------------------------------------------------------
create table if not exists reuniao_recorrencias (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  titulo                text not null check (length(trim(titulo)) > 0),
  tipo                  text not null check (tipo in ('diaria','semanal','mensal','trimestral','extraordinaria')),
  frequencia            text not null check (frequencia in ('semanal','quinzenal','mensal','trimestral')),
  dia_semana            int  not null check (dia_semana between 0 and 6),        -- 0 = domingo
  semana_do_mes         int  check (semana_do_mes between 1 and 5),             -- 5 = última (mensal/trimestral)
  hora                  time not null default '08:00',
  duracao_min           int  not null default 60 check (duracao_min > 0),
  local                 text,
  conduzida_por         uuid references perfis(id) on delete set null,
  participantes         uuid[] not null default '{}',
  antecedencia_dias     int  not null default 6 check (antecedencia_dias between 1 and 60),
  ativo                 boolean not null default true,
  criado_por            uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now(),
  check (frequencia in ('semanal','quinzenal') or semana_do_mes is not null)
);

alter table reunioes add column if not exists recorrencia_id uuid references reuniao_recorrencias(id) on delete set null;
create index if not exists idx_reunioes_recorrencia on reunioes(recorrencia_id, data_hora desc);

alter table reuniao_recorrencias enable row level security;
drop policy if exists recorrencias_ler on reuniao_recorrencias;
drop policy if exists recorrencias_gerir on reuniao_recorrencias;
create policy recorrencias_ler on reuniao_recorrencias for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente()));
create policy recorrencias_gerir on reuniao_recorrencias for all
  using      (empresa_consultora_id = (select auth_empresa_id()) and (select pode_conduzir()))
  with check (empresa_consultora_id = (select auth_empresa_id()) and (select pode_conduzir()));

-- 2) Datas da série ---------------------------------------------------------------------
create or replace function _ritmo_hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;

-- n-ésimo dia da semana do mês (n = 5 → o último)
create or replace function _ritmo_nth_weekday(p_mes date, p_dow int, p_n int)
returns date language plpgsql immutable as $$
declare
  v_ini date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_d   date;
begin
  if p_n >= 5 then
    v_d := v_fim - ((extract(dow from v_fim)::int - p_dow + 7) % 7);
  else
    v_d := v_ini + ((p_dow - extract(dow from v_ini)::int + 7) % 7) + (p_n - 1) * 7;
  end if;
  return v_d;
end $$;

-- Próxima data do molde: a primeira ocorrência >= hoje e depois da última reunião da série.
create or replace function _ritmo_proxima_data(p_rec uuid)
returns date language plpgsql stable security definer set search_path = public as $$
declare
  r       reuniao_recorrencias%rowtype;
  v_ult   date;
  v_base  date;
  v_d     date;
  v_mes   date;
  v_passo int;
  i       int := 0;
begin
  select * into r from reuniao_recorrencias where id = p_rec;
  if r.id is null then return null; end if;
  select max((data_hora at time zone 'America/Fortaleza')::date) into v_ult from reunioes where recorrencia_id = r.id;
  v_base := greatest(_ritmo_hoje(), coalesce(v_ult + 1, _ritmo_hoje()));

  if r.frequencia = 'semanal' then
    return v_base + ((r.dia_semana - extract(dow from v_base)::int + 7) % 7);
  elsif r.frequencia = 'quinzenal' then
    if v_ult is null then
      return v_base + ((r.dia_semana - extract(dow from v_base)::int + 7) % 7);
    end if;
    v_d := v_ult + 14;
    while v_d < _ritmo_hoje() and i < 100 loop v_d := v_d + 14; i := i + 1; end loop;
    return v_d;
  else
    v_passo := case when r.frequencia = 'trimestral' then 3 else 1 end;
    -- trimestral: anda de 3 em 3 a partir do mês da última reunião; sem histórico, a partir do mês corrente
    v_mes := case when r.frequencia = 'trimestral' and v_ult is not null
                  then (date_trunc('month', v_ult) + make_interval(months => v_passo))::date
                  else date_trunc('month', v_base)::date end;
    loop
      v_d := _ritmo_nth_weekday(v_mes, r.dia_semana, coalesce(r.semana_do_mes, 1));
      exit when v_d >= v_base or i > 40;
      v_mes := (v_mes + make_interval(months => v_passo))::date;
      i := i + 1;
    end loop;
    return v_d;
  end if;
end $$;
revoke all on function _ritmo_proxima_data(uuid) from public, anon, authenticated;

-- Para a tela: próximas datas previstas dos moldes que a pessoa vê (gerência).
create or replace function ritmo_previstas()
returns table (recorrencia_id uuid, titulo text, tipo text, data_prevista date, hora time, criada boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.titulo, r.tipo, d.d, r.hora,
         exists (select 1 from reunioes x where x.recorrencia_id = r.id
                  and (x.data_hora at time zone 'America/Fortaleza')::date = d.d)
    from reuniao_recorrencias r
    cross join lateral (select _ritmo_proxima_data(r.id) as d) d
   where r.empresa_consultora_id = auth_empresa_id() and r.ativo and is_gerente()
$$;
grant execute on function ritmo_previstas() to authenticated;

-- 3) Farol em SQL (espelho de lib/kpis.ts) -------------------------------------------
create or replace function kpi_farol(p_valor numeric, p_meta numeric, p_tol numeric, p_sentido text)
returns text language sql immutable as $$
  select case
    when p_valor is null then 'sem_dado'
    when p_meta is null then 'sem_meta'
    when p_sentido = 'maior' then
      case when p_valor >= p_meta then 'verde'
           when p_valor >= p_meta - abs(p_meta) * coalesce(p_tol, 10) / 100 then 'amarelo'
           else 'vermelho' end
    else
      case when p_valor <= p_meta then 'verde'
           when p_valor <= p_meta + abs(p_meta) * coalesce(p_tol, 10) / 100 then 'amarelo'
           else 'vermelho' end
  end
$$;
grant execute on function kpi_farol(numeric, numeric, numeric, text) to authenticated;

create or replace function _kpi_fmt(p_valor numeric, p_unidade text)
returns text language sql immutable as $$
  select case when p_valor is null then '—'
    when p_unidade = 'pct' then replace(round(p_valor, 1)::text, '.', ',') || '%'
    when p_unidade = 'meses' then replace(round(p_valor, 1)::text, '.', ',') || ' meses'
    when p_unidade = 'dias' then round(p_valor)::text || ' dias'
    when p_unidade = 'brl' then 'R$ ' || round(p_valor)::text
    else replace(round(p_valor, 2)::text, '.', ',') end
$$;

-- 4) KPIs: núcleo do recálculo reaproveitado pela RPC e pelo cron ---------------------
create or replace function _kpi_atualizar_empresa(p_emp uuid, p_periodo date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_ini   date := date_trunc('month', p_periodo)::date;
  v_fim   date := (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date;
  v_atual date := date_trunc('month', (now() at time zone 'America/Fortaleza'))::date;
  k       record;
  v_n     int := 0;
begin
  if v_ini > v_atual then return 0; end if;
  for k in select kp.id, kp.catalogo_chave, c.foto
             from kpis kp join kpi_catalogo c on c.chave = kp.catalogo_chave
            where kp.empresa_consultora_id = p_emp and kp.ativo and c.coleta = 'automatico' loop
    continue when k.foto and v_ini <> v_atual;      -- foto: mês passado fica congelado
    insert into kpi_medicoes (kpi_id, periodo, empresa_consultora_id, valor, origem, registrado_por, atualizado_em)
    values (k.id, v_ini, p_emp, _kpi_valor_auto(k.catalogo_chave, p_emp, v_ini, v_fim), 'automatico', auth.uid(), now())
    on conflict (kpi_id, periodo) do update
      set valor = excluded.valor, atualizado_em = now(), registrado_por = excluded.registrado_por;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function _kpi_atualizar_empresa(uuid, date) from public, anon, authenticated;

create or replace function kpi_atualizar(p_periodo date)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not is_gerente() then raise exception 'Somente a gerência atualiza os indicadores'; end if;
  return _kpi_atualizar_empresa(auth_empresa_id(), p_periodo);
end $$;

create or replace function ritmo_cron_kpis()
returns int language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_n int := 0;
begin
  for v_emp in select distinct empresa_consultora_id from kpis where ativo loop
    v_n := v_n + _kpi_atualizar_empresa(v_emp, _ritmo_hoje());
  end loop;
  return v_n;
end $$;
revoke all on function ritmo_cron_kpis() from public, anon, authenticated;

-- 5) Pauta automática: indicadores fora da faixa -------------------------------------
create or replace function _ritmo_pauta_kpis(p_reuniao uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  r     reunioes%rowtype;
  v_mes date;
  k     record;
  v_n   int := 0;
begin
  select * into r from reunioes where id = p_reuniao;
  if r.id is null or r.tipo not in ('semanal','mensal','trimestral') then return 0; end if;
  v_mes := date_trunc('month', (r.data_hora at time zone 'America/Fortaleza'))::date;
  if r.tipo in ('mensal','trimestral') then v_mes := (v_mes - interval '1 month')::date; end if;

  for k in
    select kp.nome, kp.unidade, kp.meta, m.valor, m.observacao, c.decisao,
           kpi_farol(m.valor, kp.meta, kp.tolerancia, kp.sentido) as f
      from kpis kp
      join kpi_medicoes m on m.kpi_id = kp.id and m.periodo = v_mes
      left join kpi_catalogo c on c.chave = kp.catalogo_chave
     where kp.empresa_consultora_id = r.empresa_consultora_id and kp.ativo
     order by kp.ordem
  loop
    continue when k.f not in ('vermelho','amarelo');
    continue when exists (select 1 from reuniao_pauta where reuniao_id = r.id and titulo = '📊 ' || k.nome);
    insert into reuniao_pauta (reuniao_id, empresa_consultora_id, titulo, descricao, origem, status, ordem)
    values (r.id, r.empresa_consultora_id, '📊 ' || k.nome,
            to_char(v_mes, 'MM/YYYY') || ': ' || _kpi_fmt(k.valor, k.unidade) || ' · meta ' || _kpi_fmt(k.meta, k.unidade)
            || case when k.f = 'vermelho' then ' (fora da meta)' else ' (atenção)' end
            || E'\n' || coalesce('Causa registrada: ' || k.observacao, 'Sem causa registrada — discutir a causa antes da solução.')
            || coalesce(E'\nDecisão que apoia: ' || k.decisao, ''),
            'indicador', 'aceito', -100 + v_n);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function _ritmo_pauta_kpis(uuid) from public, anon, authenticated;

-- 6) Criação automática das reuniões --------------------------------------------------
create or replace function ritmo_cron_reunioes()
returns int language plpgsql security definer set search_path = public as $$
declare
  r      reuniao_recorrencias%rowtype;
  v_d    date;
  v_ant  uuid;
  v_id   uuid;
  v_pid  uuid;
  v_cond uuid;
  v_n    int := 0;
  a      record;
begin
  for r in select * from reuniao_recorrencias where ativo loop
    v_d := _ritmo_proxima_data(r.id);
    continue when v_d is null or v_d - _ritmo_hoje() > r.antecedencia_dias;
    continue when exists (select 1 from reunioes where recorrencia_id = r.id
                            and (data_hora at time zone 'America/Fortaleza')::date = v_d);

    select id into v_ant from reunioes
     where recorrencia_id = r.id and status <> 'cancelada'
     order by data_hora desc limit 1;
    v_cond := coalesce(r.conduzida_por, r.criado_por);

    insert into reunioes (empresa_consultora_id, titulo, tipo, data_hora, duracao_min, local, confidencial,
                          conduzida_por, anterior_id, recorrencia_id, criado_por)
    values (r.empresa_consultora_id, r.titulo, r.tipo, (v_d + r.hora) at time zone 'America/Fortaleza',
            r.duracao_min, r.local, false, v_cond, v_ant, r.id, v_cond)
    returning id into v_id;

    -- participantes (o gatilho de 0070 manda o convite)
    foreach v_pid in array (r.participantes || array[v_cond]) loop
      if v_pid is not null and exists (select 1 from perfis where id = v_pid
                                         and empresa_consultora_id = r.empresa_consultora_id and ativo) then
        insert into reuniao_participantes (reuniao_id, perfil_id, empresa_consultora_id)
        values (v_id, v_pid, r.empresa_consultora_id) on conflict do nothing;
      end if;
    end loop;

    -- adiados da anterior voltam (se a ata dela já foi fechada)
    if v_ant is not null then
      insert into reuniao_pauta (reuniao_id, empresa_consultora_id, titulo, descricao, origem, status, ordem)
      select v_id, r.empresa_consultora_id, p.titulo, p.descricao, 'pendencia', 'aceito', row_number() over (order by p.ordem)
        from reuniao_pauta p where p.reuniao_id = v_ant and p.status = 'adiado';
    end if;

    perform _ritmo_pauta_kpis(v_id);
    v_n := v_n + 1;
  end loop;

  -- Sincroniza: ata fechada DEPOIS que a próxima já existia → os adiados entram nela.
  for a in
    select nx.id as prox, nx.empresa_consultora_id as emp, p.titulo, p.descricao, p.ordem
      from reunioes nx
      join reunioes an on an.id = nx.anterior_id and an.status = 'realizada'
      join reuniao_pauta p on p.reuniao_id = an.id and p.status = 'adiado'
     where nx.status = 'agendada'
       -- só atas fechadas depois de a próxima existir, e só no dia seguinte ao
       -- fechamento (se alguém tirar o item da pauta, ele não volta sozinho)
       and an.ata_fechada_em > nx.criado_em
       and an.ata_fechada_em > now() - interval '1 day'
       and not exists (select 1 from reuniao_pauta q where q.reuniao_id = nx.id and q.titulo = p.titulo)
  loop
    insert into reuniao_pauta (reuniao_id, empresa_consultora_id, titulo, descricao, origem, status, ordem)
    values (a.prox, a.emp, a.titulo, a.descricao, 'pendencia', 'aceito', a.ordem);
  end loop;

  return v_n;
end $$;
revoke all on function ritmo_cron_reunioes() from public, anon, authenticated;

-- 7) Lembretes ---------------------------------------------------------------------------
create or replace function ritmo_cron_lembretes()
returns int language plpgsql security definer set search_path = public as $$
declare
  r       record;
  p       record;
  v_itens int;
  v_sug   int;
  v_n     int := 0;
  v_amanha date := _ritmo_hoje() + 1;
begin
  -- véspera
  for r in select * from reunioes
            where status = 'agendada' and lembrete_em is null
              and (data_hora at time zone 'America/Fortaleza')::date = v_amanha loop
    perform _ritmo_pauta_kpis(r.id);   -- indicadores que saíram da faixa desde a criação
    select count(*) filter (where status = 'aceito'), count(*) filter (where status = 'proposto')
      into v_itens, v_sug from reuniao_pauta where reuniao_id = r.id;
    for p in select perfil_id from reuniao_participantes where reuniao_id = r.id loop
      perform _notificar_reuniao(p.perfil_id, r.id,
        'Amanhã: ' || r.titulo || ' às ' || to_char(r.data_hora at time zone 'America/Fortaleza', 'HH24:MI')
        || coalesce(' · ' || nullif(r.local, ''), '') || ' · pauta com ' || v_itens || ' item(ns). Tem assunto? Sugira na pauta.');
      v_n := v_n + 1;
    end loop;
    if v_sug > 0 then
      perform _notificar_reuniao(coalesce(r.conduzida_por, r.criado_por), r.id,
        v_sug || ' sugestão(ões) de pauta aguardando você para ' || r.titulo || ' amanhã.');
      v_n := v_n + 1;
    end if;
    update reunioes set lembrete_em = now() where id = r.id;
  end loop;

  -- ata não fechada (passou mais de 1 dia): avisa quem conduz, a cada 3 dias, até 3 vezes
  for r in select * from reunioes
            where status in ('agendada','em_andamento')
              and data_hora < now() - interval '1 day'
              and lembretes_ata < 3
              and (lembrete_ata_em is null or lembrete_ata_em < now() - interval '3 days') loop
    perform _notificar_reuniao(coalesce(r.conduzida_por, r.criado_por), r.id,
      'A ata de ' || r.titulo || ' (' || to_char(r.data_hora at time zone 'America/Fortaleza', 'DD/MM')
      || ') ainda não foi fechada — os encaminhamentos só viram tarefa depois disso.');
    update reunioes set lembrete_ata_em = now(), lembretes_ata = lembretes_ata + 1 where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function ritmo_cron_lembretes() from public, anon, authenticated;

-- 8) Agenda (UTC; Fortaleza = UTC-3) -------------------------------------------------------
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('ritmo_reunioes', 'ritmo_lembretes', 'ritmo_kpis');
select cron.schedule('ritmo_reunioes',  '0 10 * * *',  $$ select public.ritmo_cron_reunioes() $$);
select cron.schedule('ritmo_lembretes', '0 19 * * *',  $$ select public.ritmo_cron_lembretes() $$);
select cron.schedule('ritmo_kpis',      '30 2 * * *',  $$ select public.ritmo_cron_kpis() $$);
