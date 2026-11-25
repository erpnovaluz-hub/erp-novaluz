-- =============================================================================
-- CRM/ERP NOVALUZ — 0070 Ritmo de Gestão · Bloco 1: reuniões, atas e
-- encaminhamentos (spec: docs/ritmo-gestao/bloco1-spec.md)
--
-- Ciclo: reunião → decisão → encaminhamento (dono, prazo, evidência) → tarefa
--        → a reunião seguinte da série (anterior_id) cobra as pendências.
--
-- Acesso:
--   conduzir (criar/editar/fechar) → super, ou gerência marcada com
--                                     perfis.conduz_reunioes (flag por pessoa)
--   ver reunião normal             → gerência, participantes, quem criou, donos de encaminhamento
--   ver reunião CONFIDENCIAL       → só participantes, quem criou e donos de encaminhamento
--                                     (nem a gerência)
--   tarefas de reunião confidencial (tarefas.reuniao_restrita_id) seguem a
--   mesma regra — a policy de tarefas ganha essa trava.
--
-- Ata fechada (status 'realizada') é imutável; só a RPC ritmo_reabrir_ata
-- reabre, registrando quem, quando e por quê.
--
-- Depende de 0040 (is_gerente/is_super), 0041/0044 (tarefas, vw_tarefas),
-- 0042 (notificacoes), 0049 (acompanhantes), 0051 (notificacoes.os_id),
-- 0064 (tipo 'agente').
-- =============================================================================

-- 0) Quem conduz reuniões -------------------------------------------------------
alter table perfis add column if not exists conduz_reunioes boolean not null default false;

create or replace function pode_conduzir()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_super()
     or (is_gerente() and (select p.conduz_reunioes from perfis p where p.id = auth.uid())), false)
$$;
grant execute on function pode_conduzir() to authenticated;

-- proteger_perfil (0040) + a nova flag: só a gerência altera, e não a própria
create or replace function proteger_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service role (API) e super admin passam direto
  if auth.uid() is null or is_super() then return new; end if;

  if new.empresa_consultora_id is distinct from old.empresa_consultora_id
     or new.empresa_ativa is distinct from old.empresa_ativa then
    raise exception 'Sem permissão para trocar a empresa do usuário';
  end if;

  if new.papel is distinct from old.papel or new.ativo is distinct from old.ativo then
    if not is_gerente() then
      raise exception 'Somente a gerência altera papel ou status de usuários';
    end if;
    if new.id = auth.uid() then
      raise exception 'Você não pode alterar o próprio papel ou status';
    end if;
    if old.papel = 'super' or new.papel = 'super' then
      raise exception 'Papel super é exclusivo do administrador central';
    end if;
  end if;

  if new.conduz_reunioes is distinct from old.conduz_reunioes then
    if not is_gerente() then
      raise exception 'Somente a gerência define quem conduz reuniões';
    end if;
    if new.id = auth.uid() then
      raise exception 'Você não pode alterar a sua própria permissão de conduzir reuniões';
    end if;
  end if;
  return new;
end $$;

-- 1) Tabelas ------------------------------------------------------------------------
create table if not exists reunioes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  titulo                text not null,
  tipo                  text not null default 'semanal'
                          check (tipo in ('diaria','semanal','mensal','trimestral','extraordinaria')),
  data_hora             timestamptz not null,
  duracao_min           int not null default 60 check (duracao_min > 0),
  local                 text,
  confidencial          boolean not null default false,
  status                text not null default 'agendada'
                          check (status in ('agendada','em_andamento','realizada','cancelada')),
  conduzida_por         uuid references perfis(id) on delete set null default auth.uid(),
  anterior_id           uuid references reunioes(id) on delete set null,
  ata_fechada_em        timestamptz,
  ata_fechada_por       uuid references perfis(id) on delete set null,
  reaberturas           jsonb not null default '[]'::jsonb,
  observacoes           text,
  criado_por            uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);
create index if not exists idx_reunioes_empresa  on reunioes(empresa_consultora_id, data_hora desc);
create index if not exists idx_reunioes_anterior on reunioes(anterior_id);

create table if not exists reuniao_participantes (
  reuniao_id            uuid not null references reunioes(id) on delete cascade,
  perfil_id             uuid not null references perfis(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  presenca              text not null default 'convidado' check (presenca in ('convidado','presente','ausente')),
  ciencia_em            timestamptz,
  primary key (reuniao_id, perfil_id)
);
create index if not exists idx_reuniao_part_perfil on reuniao_participantes(perfil_id);

create table if not exists reuniao_pauta (
  id                    uuid primary key default gen_random_uuid(),
  reuniao_id            uuid not null references reunioes(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  titulo                text not null,
  descricao             text,
  origem                text not null default 'manual' check (origem in ('manual','sugestao','pendencia')),
  status                text not null default 'aceito'
                          check (status in ('proposto','aceito','recusado','discutido','adiado')),
  sugerido_por          uuid references perfis(id) on delete set null,
  motivo_recusa         text,
  ordem                 double precision not null default 0,
  criado_em             timestamptz not null default now()
);
create index if not exists idx_reuniao_pauta on reuniao_pauta(reuniao_id, ordem);

create table if not exists reuniao_decisoes (
  id                    uuid primary key default gen_random_uuid(),
  reuniao_id            uuid not null references reunioes(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  pauta_id              uuid references reuniao_pauta(id) on delete set null,
  texto                 text not null,
  ordem                 double precision not null default 0,
  criado_em             timestamptz not null default now()
);
create index if not exists idx_reuniao_decisoes on reuniao_decisoes(reuniao_id, ordem);

create table if not exists reuniao_encaminhamentos (
  id                    uuid primary key default gen_random_uuid(),
  reuniao_id            uuid not null references reunioes(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  decisao_id            uuid references reuniao_decisoes(id) on delete set null,
  pauta_id              uuid references reuniao_pauta(id) on delete set null,
  o_que                 text not null check (length(trim(o_que)) > 0),
  dono_id               uuid not null references perfis(id),
  prazo                 date not null,
  evidencia             text not null check (length(trim(evidencia)) > 0),
  -- partes que viram subtarefas: [{"o_que":"…","responsavel_id":"uuid","prazo":"2026-12-05"}]
  partes                jsonb not null default '[]'::jsonb,
  tarefa_id             uuid references tarefas(id) on delete set null,
  cancelado             boolean not null default false,
  motivo_cancelamento   text,
  ordem                 double precision not null default 0,
  criado_em             timestamptz not null default now()
);
create index if not exists idx_reuniao_enc        on reuniao_encaminhamentos(reuniao_id, ordem);
create index if not exists idx_reuniao_enc_dono   on reuniao_encaminhamentos(dono_id);
create index if not exists idx_reuniao_enc_tarefa on reuniao_encaminhamentos(tarefa_id);

-- o que a reunião N disse sobre um encaminhamento de uma reunião anterior da série
create table if not exists reuniao_revisoes (
  encaminhamento_id     uuid not null references reuniao_encaminhamentos(id) on delete cascade,
  reuniao_id            uuid not null references reunioes(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  situacao              text not null check (situacao in ('feito','nao_feito','replanejado','cancelado')),
  motivo                text,
  novo_prazo            date,
  criado_em             timestamptz not null default now(),
  primary key (encaminhamento_id, reuniao_id),
  check (situacao <> 'nao_feito'   or length(trim(coalesce(motivo, ''))) > 0),
  check (situacao <> 'replanejado' or novo_prazo is not null)
);
create index if not exists idx_reuniao_rev_reuniao on reuniao_revisoes(reuniao_id);

-- 2) Visibilidade ------------------------------------------------------------------
create or replace function e_participante(p_reuniao uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from reuniao_participantes
                  where reuniao_id = p_reuniao and perfil_id = auth.uid())
$$;

-- dono de um encaminhamento responde por ele: vê a ata de onde ele saiu,
-- mesmo sem ter participado
create or replace function e_dono_encaminhamento(p_reuniao uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from reuniao_encaminhamentos
                  where reuniao_id = p_reuniao and dono_id = auth.uid())
$$;

create or replace function pode_ver_reuniao(p_reuniao uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from reunioes r
     where r.id = p_reuniao
       and r.empresa_consultora_id = auth_empresa_id()
       and (r.criado_por = auth.uid() or e_participante(r.id) or e_dono_encaminhamento(r.id)
            or (not r.confidencial and is_gerente())))
$$;

create or replace function pode_gerir_reuniao(p_reuniao uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pode_conduzir() and pode_ver_reuniao(p_reuniao)
$$;

-- pauta, decisões, encaminhamentos e presença só mudam com a ata aberta
create or replace function reuniao_editavel(p_reuniao uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from reunioes where id = p_reuniao and status in ('agendada','em_andamento'))
$$;

grant execute on function e_participante(uuid), e_dono_encaminhamento(uuid), pode_ver_reuniao(uuid),
  pode_gerir_reuniao(uuid), reuniao_editavel(uuid) to authenticated;

-- reunioes
alter table reunioes enable row level security;
drop policy if exists reunioes_ler on reunioes;
drop policy if exists reunioes_inserir on reunioes;
drop policy if exists reunioes_alterar on reunioes;
drop policy if exists reunioes_excluir on reunioes;
create policy reunioes_ler on reunioes for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and (criado_por = (select auth.uid()) or e_participante(id) or e_dono_encaminhamento(id)
              or (not confidencial and (select is_gerente()))));
create policy reunioes_inserir on reunioes for insert
  with check (empresa_consultora_id = (select auth_empresa_id()) and (select pode_conduzir())
              and criado_por = (select auth.uid()) and status in ('agendada','em_andamento'));
-- ata fechada não se edita pela tela (USING bloqueia 'realizada'); fechar/reabrir são RPCs
create policy reunioes_alterar on reunioes for update
  using      (empresa_consultora_id = (select auth_empresa_id()) and pode_gerir_reuniao(id)
              and status <> 'realizada')
  with check (empresa_consultora_id = (select auth_empresa_id()) and status <> 'realizada');
create policy reunioes_excluir on reunioes for delete
  using (empresa_consultora_id = (select auth_empresa_id()) and pode_gerir_reuniao(id)
         and status in ('agendada','cancelada'));

-- tabelas-filhas: ler = quem vê a reunião; escrever = quem conduz, com a ata aberta
do $$
declare t text;
begin
  foreach t in array array['reuniao_participantes','reuniao_pauta','reuniao_decisoes',
                           'reuniao_encaminhamentos','reuniao_revisoes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_ler', t);
    execute format('drop policy if exists %I on %I', t || '_escrever', t);
    execute format($p$create policy %I on %I for select
      using (empresa_consultora_id = (select auth_empresa_id()) and pode_ver_reuniao(reuniao_id))$p$, t || '_ler', t);
    execute format($p$create policy %I on %I for all
      using      (empresa_consultora_id = (select auth_empresa_id()) and pode_gerir_reuniao(reuniao_id) and reuniao_editavel(reuniao_id))
      with check (empresa_consultora_id = (select auth_empresa_id()) and pode_gerir_reuniao(reuniao_id) and reuniao_editavel(reuniao_id))$p$,
      t || '_escrever', t);
  end loop;
end $$;

-- 3) Tarefas: vínculo 'reuniao' e trava das confidenciais ----------------------------
alter table tarefas drop constraint if exists tarefas_vinculo_tipo_check;
alter table tarefas add constraint tarefas_vinculo_tipo_check
  check (vinculo_tipo in ('os','obra','cliente','oportunidade','proposta','titulo','requisicao','pedido','reuniao'));

-- on delete restrict: apagar a reunião não pode "destrancar" as tarefas confidenciais
alter table tarefas add column if not exists reuniao_restrita_id uuid references reunioes(id) on delete restrict;
create index if not exists idx_tarefas_restrita on tarefas(reuniao_restrita_id) where reuniao_restrita_id is not null;

-- subtarefa herda a restrição da mãe
create or replace function _tarefa_herda_restrita()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null and new.reuniao_restrita_id is null then
    select reuniao_restrita_id into new.reuniao_restrita_id from tarefas where id = new.parent_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_tarefa_herda_restrita on tarefas;
create trigger trg_tarefa_herda_restrita before insert on tarefas
  for each row execute function _tarefa_herda_restrita();

-- tarefa restrita: só responsável, criador, acompanhantes e envolvidos na reunião
create or replace function pode_ver_restrita(p_reuniao uuid, p_resp uuid, p_criador uuid, p_tarefa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_reuniao is null
      or p_resp = auth.uid()
      or p_criador = auth.uid()
      or e_acompanhante(p_tarefa)
      or e_participante(p_reuniao)
      or exists (select 1 from reunioes r where r.id = p_reuniao and r.criado_por = auth.uid())
$$;
grant execute on function pode_ver_restrita(uuid, uuid, uuid, uuid) to authenticated;

-- policies de tarefas: versão 0049 (+ acompanhantes) com a trava de restrita
drop policy if exists tarefas_ler on tarefas;
drop policy if exists tarefas_alterar on tarefas;
drop policy if exists tarefas_excluir on tarefas;
create policy tarefas_ler on tarefas for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and (pode_ver_tarefa(projeto_id, responsavel_id, criado_por) or e_acompanhante(id))
         and pode_ver_restrita(reuniao_restrita_id, responsavel_id, criado_por, id));
create policy tarefas_alterar on tarefas for update
  using      (empresa_consultora_id = (select auth_empresa_id())
              and (pode_ver_tarefa(projeto_id, responsavel_id, criado_por) or e_acompanhante(id))
              and pode_ver_restrita(reuniao_restrita_id, responsavel_id, criado_por, id))
  with check (empresa_consultora_id = (select auth_empresa_id())
              and (projeto_id is null or pode_ver_projeto(projeto_id)
                   or responsavel_id = (select auth.uid()) or criado_por = (select auth.uid()) or e_acompanhante(id)));
create policy tarefas_excluir on tarefas for delete
  using (empresa_consultora_id = (select auth_empresa_id())
         and (criado_por = (select auth.uid()) or (select is_gerente())
              or (projeto_id is not null and pode_gerir_projeto(projeto_id)))
         and pode_ver_restrita(reuniao_restrita_id, responsavel_id, criado_por, id));

-- vw_tarefas congela as colunas: recria para incluir reuniao_restrita_id
drop view if exists vw_tarefas;
create view vw_tarefas as
  select t.*,
         (select count(*) from tarefas s where s.parent_id = t.id)                  as n_sub,
         (select count(*) from tarefas s where s.parent_id = t.id and s.concluida)  as n_sub_ok
    from tarefas t;
alter view vw_tarefas set (security_invoker = on);
revoke all on vw_tarefas from anon;
grant select on vw_tarefas to authenticated;

-- 4) Notificações de reunião ------------------------------------------------------------
alter table notificacoes add column if not exists reuniao_id uuid references reunioes(id) on delete cascade;
alter table notificacoes drop constraint if exists notificacoes_tipo_check;
alter table notificacoes add constraint notificacoes_tipo_check
  check (tipo in ('atribuida','mencao','comentario','concluida','acompanhar',
                  'os_atribuida','os_status','agente','reuniao'));

create or replace function _notificar_reuniao(p_dest uuid, p_reuniao uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  if p_dest is null or p_dest = auth.uid() then return; end if;
  select empresa_consultora_id into v_emp from reunioes where id = p_reuniao;
  if not exists (select 1 from perfis where id = p_dest and empresa_consultora_id = v_emp and ativo) then return; end if;
  insert into notificacoes (empresa_consultora_id, destinatario_id, ator_id, tipo, reuniao_id, texto)
  values (v_emp, p_dest, auth.uid(), 'reuniao', p_reuniao, left(p_texto, 280));
end $$;

-- convite: incluído como participante de reunião ainda não realizada
create or replace function _notificar_convite_reuniao()
returns trigger language plpgsql security definer set search_path = public as $$
declare r reunioes%rowtype;
begin
  select * into r from reunioes where id = new.reuniao_id;
  if r.status in ('agendada','em_andamento') then
    perform _notificar_reuniao(new.perfil_id, r.id,
      'Convite: ' || r.titulo || ' — ' ||
      to_char(r.data_hora at time zone 'America/Fortaleza', 'DD/MM "às" HH24:MI') ||
      coalesce(' · ' || nullif(r.local, ''), ''));
  end if;
  return new;
end $$;
drop trigger if exists trg_notificar_convite_reuniao on reuniao_participantes;
create trigger trg_notificar_convite_reuniao after insert on reuniao_participantes
  for each row execute function _notificar_convite_reuniao();

-- 5) Encaminhamentos com status (fonte única: tarefa + revisões) -----------------------
-- prazo efetivo = último replanejamento formal (revisão) ou o prazo combinado na ata.
-- "feito" = tarefa-mãe concluída ou a reunião registrou "feito".
create or replace view vw_encaminhamentos as
  select e.*,
         r.titulo        as reuniao_titulo,
         r.tipo          as reuniao_tipo,
         r.data_hora     as reuniao_data,
         r.confidencial  as reuniao_confidencial,
         r.status        as reuniao_status,
         t.concluida     as tarefa_concluida,
         t.concluida_em  as tarefa_concluida_em,
         (select count(*) from tarefas s where s.parent_id = e.tarefa_id)                 as n_sub,
         (select count(*) from tarefas s where s.parent_id = e.tarefa_id and s.concluida) as n_sub_ok,
         ult.situacao    as ultima_situacao,
         coalesce(ult_prazo.novo_prazo, e.prazo) as prazo_efetivo,
         case
           when e.cancelado or ult.situacao = 'cancelado' then 'cancelado'
           when coalesce(t.concluida, false) then
             case when (t.concluida_em at time zone 'America/Fortaleza')::date
                       <= coalesce(ult_prazo.novo_prazo, e.prazo)
                  then 'feito_no_prazo' else 'feito_atrasado' end
           when ult.situacao = 'feito' then
             case when (ult.data at time zone 'America/Fortaleza')::date
                       <= coalesce(ult_prazo.novo_prazo, e.prazo)
                  then 'feito_no_prazo' else 'feito_atrasado' end
           when coalesce(ult_prazo.novo_prazo, e.prazo) < (now() at time zone 'America/Fortaleza')::date
             then 'atrasado'
           else 'aberto'
         end as status
    from reuniao_encaminhamentos e
    join reunioes r on r.id = e.reuniao_id
    left join tarefas t on t.id = e.tarefa_id
    left join lateral (
      select rv.situacao, rr.data_hora as data
        from reuniao_revisoes rv join reunioes rr on rr.id = rv.reuniao_id
       where rv.encaminhamento_id = e.id
       order by rr.data_hora desc limit 1) ult on true
    left join lateral (
      select rv.novo_prazo
        from reuniao_revisoes rv join reunioes rr on rr.id = rv.reuniao_id
       where rv.encaminhamento_id = e.id and rv.novo_prazo is not null
       order by rr.data_hora desc limit 1) ult_prazo on true;
alter view vw_encaminhamentos set (security_invoker = on);
revoke all on vw_encaminhamentos from anon;
grant select on vw_encaminhamentos to authenticated;

-- 6) Pendências da série ----------------------------------------------------------------
-- Encaminhamentos das reuniões anteriores da cadeia (anterior_id) que ainda não
-- foram dados como feitos/cancelados. Cada um precisa ser revisado na reunião atual.
create or replace function ritmo_pendencias(p_reuniao uuid)
returns table (encaminhamento_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not pode_ver_reuniao(p_reuniao) then return; end if;
  return query
  with recursive cadeia as (
    select r.anterior_id as id, 1 as nivel from reunioes r where r.id = p_reuniao
    union all
    select r.anterior_id, c.nivel + 1 from reunioes r join cadeia c on r.id = c.id
     where c.id is not null and c.nivel < 60
  )
  select e.id
    from reuniao_encaminhamentos e
    join reunioes r on r.id = e.reuniao_id
   where e.reuniao_id in (select id from cadeia where id is not null)
     and r.status = 'realizada'
     and not e.cancelado
     -- já encerrado numa revisão de outra reunião?
     and not exists (select 1 from reuniao_revisoes rv
                      where rv.encaminhamento_id = e.id and rv.reuniao_id <> p_reuniao
                        and rv.situacao in ('feito','cancelado'))
     -- tarefa concluída antes desta reunião também sai… mas só depois de revisada
     -- uma vez (para a ata registrar o "feito"); por isso não filtramos por tarefa aqui.
   order by r.data_hora, e.ordem;
end $$;
grant execute on function ritmo_pendencias(uuid) to authenticated;

-- 7) RPCs ---------------------------------------------------------------------------------
-- Nova reunião + participantes + itens "adiados" da anterior voltam para a pauta.
-- p_anterior nulo → última reunião realizada do mesmo tipo (só para não confidenciais).
create or replace function ritmo_criar_reuniao(
  p_titulo text, p_tipo text, p_data_hora timestamptz, p_duracao int, p_local text,
  p_confidencial boolean, p_conduzida_por uuid, p_anterior uuid, p_participantes uuid[],
  p_observacoes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := auth_empresa_id();
  v_id  uuid;
  v_ant uuid := p_anterior;
  v_pid uuid;
begin
  if v_emp is null then raise exception 'Usuário sem empresa'; end if;
  if not pode_conduzir() then raise exception 'Você não tem permissão para conduzir reuniões'; end if;
  if nullif(trim(p_titulo), '') is null then raise exception 'Informe o título da reunião'; end if;
  if p_data_hora is null then raise exception 'Informe data e hora'; end if;

  if v_ant is not null and not pode_ver_reuniao(v_ant) then
    raise exception 'Reunião anterior não encontrada';
  end if;
  if v_ant is null and not coalesce(p_confidencial, false) then
    select id into v_ant from reunioes
     where empresa_consultora_id = v_emp and tipo = p_tipo and status = 'realizada'
       and not confidencial and data_hora < p_data_hora
     order by data_hora desc limit 1;
  end if;

  insert into reunioes (empresa_consultora_id, titulo, tipo, data_hora, duracao_min, local, confidencial,
                        conduzida_por, anterior_id, observacoes, criado_por)
  values (v_emp, trim(p_titulo), p_tipo, p_data_hora, coalesce(p_duracao, 60), nullif(trim(p_local), ''),
          coalesce(p_confidencial, false), coalesce(p_conduzida_por, auth.uid()), v_ant,
          nullif(trim(p_observacoes), ''), auth.uid())
  returning id into v_id;

  -- quem cria e quem conduz sempre participam
  foreach v_pid in array (coalesce(p_participantes, '{}') || array[auth.uid(), coalesce(p_conduzida_por, auth.uid())]) loop
    if exists (select 1 from perfis where id = v_pid and empresa_consultora_id = v_emp and ativo) then
      insert into reuniao_participantes (reuniao_id, perfil_id, empresa_consultora_id)
      values (v_id, v_pid, v_emp) on conflict do nothing;
    end if;
  end loop;

  -- pontos em aberto (adiados) da anterior voltam à pauta
  if v_ant is not null then
    insert into reuniao_pauta (reuniao_id, empresa_consultora_id, titulo, descricao, origem, status, ordem)
    select v_id, v_emp, p.titulo, p.descricao, 'pendencia', 'aceito', row_number() over (order by p.ordem)
      from reuniao_pauta p where p.reuniao_id = v_ant and p.status = 'adiado';
  end if;
  return v_id;
end $$;

-- Participante sugere item de pauta (gerência aceita/recusa depois).
create or replace function ritmo_sugerir_pauta(p_reuniao uuid, p_titulo text, p_descricao text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r reunioes%rowtype; v_id uuid;
begin
  if not pode_ver_reuniao(p_reuniao) then raise exception 'Reunião não encontrada'; end if;
  select * into r from reunioes where id = p_reuniao;
  if r.status not in ('agendada','em_andamento') then raise exception 'A pauta desta reunião já foi encerrada'; end if;
  if nullif(trim(p_titulo), '') is null then raise exception 'Escreva o assunto que quer levar'; end if;

  insert into reuniao_pauta (reuniao_id, empresa_consultora_id, titulo, descricao, origem, status, sugerido_por, ordem)
  values (p_reuniao, r.empresa_consultora_id, trim(p_titulo), nullif(trim(p_descricao), ''), 'sugestao',
          case when pode_conduzir() then 'aceito' else 'proposto' end, auth.uid(),
          coalesce((select max(ordem) from reuniao_pauta where reuniao_id = p_reuniao), 0) + 1)
  returning id into v_id;

  perform _notificar_reuniao(coalesce(r.conduzida_por, r.criado_por), p_reuniao,
    'Sugestão de pauta para ' || r.titulo || ': ' || trim(p_titulo));
  return v_id;
end $$;

-- Gera a tarefa-mãe (e as subtarefas das "partes") de um encaminhamento. Idempotente.
create or replace function _ritmo_gerar_tarefa(p_enc uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e        reuniao_encaminhamentos%rowtype;
  r        reunioes%rowtype;
  v_proj   uuid;
  v_secao  uuid;
  v_tarefa uuid;
  v_rotulo text;
  v_tipo   text;
  v_parte  jsonb;
  v_resp   uuid;
begin
  select * into e from reuniao_encaminhamentos where id = p_enc;
  if e.id is null or e.tarefa_id is not null or e.cancelado then return e.tarefa_id; end if;
  select * into r from reunioes where id = e.reuniao_id;

  v_tipo := case r.tipo when 'diaria' then 'Diária' when 'semanal' then 'Semanal' when 'mensal' then 'Mensal'
                        when 'trimestral' then 'Trimestral' else 'Extraordinária' end;
  v_rotulo := r.titulo || ' · ' || to_char(r.data_hora at time zone 'America/Fortaleza', 'DD/MM/YYYY');

  -- confidencial: sem projeto (não aparece em quadro público)
  if not r.confidencial then
    select id into v_proj from projetos
     where empresa_consultora_id = r.empresa_consultora_id and nome = 'Ritmo de Gestão'
       and not privado and not arquivado
     order by criado_em limit 1;
    if v_proj is null then
      insert into projetos (empresa_consultora_id, nome, descricao, cor, privado, dono_id)
      values (r.empresa_consultora_id, 'Ritmo de Gestão',
              'Encaminhamentos das atas de reunião (criado automaticamente).', 'purple', false, auth.uid())
      returning id into v_proj;
    end if;
    select id into v_secao from secoes_projeto where projeto_id = v_proj and nome = v_tipo limit 1;
    if v_secao is null then
      insert into secoes_projeto (empresa_consultora_id, projeto_id, nome, ordem)
      values (r.empresa_consultora_id, v_proj, v_tipo, 0) returning id into v_secao;
    end if;
  end if;

  insert into tarefas (empresa_consultora_id, projeto_id, secao_id, titulo, descricao, responsavel_id, criado_por,
                       prazo, prioridade, vinculo_tipo, vinculo_id, vinculo_rotulo, reuniao_restrita_id)
  values (r.empresa_consultora_id, v_proj, v_secao, e.o_que,
          'Evidência de conclusão: ' || e.evidencia || E'\nOrigem: ' || v_rotulo,
          e.dono_id, auth.uid(), e.prazo, 'media', 'reuniao', r.id, v_rotulo,
          case when r.confidencial then r.id end)
  returning id into v_tarefa;

  -- quem conduz acompanha
  if r.conduzida_por is not null and r.conduzida_por <> e.dono_id then
    insert into tarefa_acompanhantes (tarefa_id, perfil_id, empresa_consultora_id)
    values (v_tarefa, r.conduzida_por, r.empresa_consultora_id) on conflict do nothing;
  end if;

  -- partes → subtarefas
  for v_parte in select * from jsonb_array_elements(coalesce(e.partes, '[]'::jsonb)) loop
    continue when nullif(trim(v_parte->>'o_que'), '') is null;
    v_resp := nullif(v_parte->>'responsavel_id', '')::uuid;
    if v_resp is not null and not exists (select 1 from perfis where id = v_resp
         and empresa_consultora_id = r.empresa_consultora_id and ativo) then
      v_resp := null;
    end if;
    insert into tarefas (empresa_consultora_id, projeto_id, secao_id, parent_id, titulo, responsavel_id, criado_por,
                         prazo, prioridade, reuniao_restrita_id)
    values (r.empresa_consultora_id, v_proj, v_secao, v_tarefa, trim(v_parte->>'o_que'), coalesce(v_resp, e.dono_id),
            auth.uid(), coalesce(nullif(v_parte->>'prazo', '')::date, e.prazo), 'media',
            case when r.confidencial then r.id end);
  end loop;

  update reuniao_encaminhamentos set tarefa_id = v_tarefa where id = e.id;
  return v_tarefa;
end $$;
revoke all on function _ritmo_gerar_tarefa(uuid) from public, anon, authenticated;

-- Fecha a ata: valida, gera tarefas, aplica revisões, avisa os presentes.
create or replace function ritmo_fechar_ata(p_reuniao uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r        reunioes%rowtype;
  v_falta  int;
  v_enc    record;
  v_rev    record;
  v_n      int := 0;
  v_part   record;
begin
  if not pode_gerir_reuniao(p_reuniao) then raise exception 'Você não pode fechar esta ata'; end if;
  select * into r from reunioes where id = p_reuniao for update;
  if r.status not in ('agendada','em_andamento') then raise exception 'Esta ata já está fechada ou a reunião foi cancelada'; end if;

  if exists (select 1 from reuniao_participantes where reuniao_id = p_reuniao and presenca = 'convidado') then
    raise exception 'Marque a presença de todos (presente ou ausente) antes de fechar';
  end if;
  if not exists (select 1 from reuniao_participantes where reuniao_id = p_reuniao and presenca = 'presente') then
    raise exception 'Nenhum participante marcado como presente';
  end if;
  if exists (select 1 from reuniao_pauta where reuniao_id = p_reuniao and status = 'proposto') then
    raise exception 'Há sugestões de pauta sem resposta: aceite ou recuse antes de fechar';
  end if;

  select count(*) into v_falta from ritmo_pendencias(p_reuniao) p
   where not exists (select 1 from reuniao_revisoes rv
                      where rv.encaminhamento_id = p.encaminhamento_id and rv.reuniao_id = p_reuniao);
  if v_falta > 0 then
    raise exception '% pendência(s) da reunião anterior ainda sem revisão (feito / não feito / replanejado)', v_falta;
  end if;

  if exists (select 1 from reuniao_encaminhamentos e
              where e.reuniao_id = p_reuniao and not e.cancelado
                and not exists (select 1 from perfis p where p.id = e.dono_id
                                  and p.empresa_consultora_id = r.empresa_consultora_id and p.ativo)) then
    raise exception 'Há encaminhamento com dono inativo ou de outra empresa';
  end if;

  -- itens aceitos e não tratados voltam na próxima
  update reuniao_pauta set status = 'adiado' where reuniao_id = p_reuniao and status = 'aceito';

  -- encaminhamentos → tarefas
  for v_enc in select id from reuniao_encaminhamentos
                where reuniao_id = p_reuniao and tarefa_id is null and not cancelado order by ordem loop
    perform _ritmo_gerar_tarefa(v_enc.id);
    v_n := v_n + 1;
  end loop;

  -- revisões: replanejado move o prazo da tarefa; cancelado encerra o encaminhamento
  for v_rev in select rv.*, e.tarefa_id from reuniao_revisoes rv
                 join reuniao_encaminhamentos e on e.id = rv.encaminhamento_id
                where rv.reuniao_id = p_reuniao loop
    if v_rev.situacao = 'replanejado' and v_rev.tarefa_id is not null then
      update tarefas set prazo = v_rev.novo_prazo where id = v_rev.tarefa_id and not concluida;
    elsif v_rev.situacao = 'cancelado' then
      update reuniao_encaminhamentos
         set cancelado = true, motivo_cancelamento = coalesce(v_rev.motivo, 'Cancelado em reunião')
       where id = v_rev.encaminhamento_id;
    end if;
  end loop;

  update reunioes set status = 'realizada', ata_fechada_em = now(), ata_fechada_por = auth.uid()
   where id = p_reuniao;

  for v_part in select perfil_id from reuniao_participantes
                 where reuniao_id = p_reuniao and presenca = 'presente' loop
    perform _notificar_reuniao(v_part.perfil_id, p_reuniao, 'Ata fechada: ' || r.titulo || ' — confirme a ciência');
  end loop;

  return jsonb_build_object('tarefas_criadas', v_n);
end $$;

-- Reabre a ata (fica registrado). Tarefas já criadas permanecem.
create or replace function ritmo_reabrir_ata(p_reuniao uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pode_gerir_reuniao(p_reuniao) then raise exception 'Você não pode reabrir esta ata'; end if;
  if nullif(trim(p_motivo), '') is null then raise exception 'Informe o motivo da reabertura'; end if;
  update reunioes
     set status = 'em_andamento', ata_fechada_em = null, ata_fechada_por = null,
         reaberturas = reaberturas || jsonb_build_array(jsonb_build_object(
           'por', auth.uid(), 'em', now(), 'motivo', trim(p_motivo)))
   where id = p_reuniao and status = 'realizada';
  if not found then raise exception 'Só uma ata fechada pode ser reaberta'; end if;
end $$;

-- Participante confirma que leu a ata.
create or replace function ritmo_dar_ciencia(p_reuniao uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from reunioes where id = p_reuniao and status = 'realizada') then
    raise exception 'A ata ainda não foi fechada';
  end if;
  update reuniao_participantes set ciencia_em = now()
   where reuniao_id = p_reuniao and perfil_id = auth.uid() and ciencia_em is null;
  if not found and not e_participante(p_reuniao) then
    raise exception 'Você não participa desta reunião';
  end if;
end $$;

grant execute on function ritmo_criar_reuniao(text, text, timestamptz, int, text, boolean, uuid, uuid, uuid[], text),
  ritmo_sugerir_pauta(uuid, text, text), ritmo_fechar_ata(uuid), ritmo_reabrir_ata(uuid, text),
  ritmo_dar_ciencia(uuid) to authenticated;

-- 8) O super já conduz; a gerência é marcada na tela Usuários e acessos. ---------------
