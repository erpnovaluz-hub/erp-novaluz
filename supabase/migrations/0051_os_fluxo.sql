-- =============================================================================
-- CRM/ERP NOVALUZ — 0051 OS 2.0 · Bloco 1: fluxo e controle
--
-- Status:  orcamento → a_fazer (aprovada) → em_andamento (em execução) ⇄ pausada
--          → concluido → faturada · cancelado
--          (as chaves antigas a_fazer/em_andamento/concluido/cancelado continuam)
-- pausada exige motivo (material, cliente, clima, equipe, outro)
-- responsavel_id: pessoa do sistema (o campo texto "responsavel" fica como antigo)
-- os_acompanhantes: quem mais acompanha a OS
-- os_historico: toda troca de status (quem, quando, motivo)
-- Avisos (🔔 e celular): OS atribuída, mudança de status, incluído como acompanhante
--
-- ATENÇÃO (SQL Editor do Supabase): sem "select ... into" — ver migration 0050.
-- Depende de 0016, 0042 (notificacoes), 0043 (_notificar_ator), 0050 (push).
-- =============================================================================

-- 1) Status e campos --------------------------------------------------------------------
alter table ordens_servico drop constraint if exists ordens_servico_status_check;
alter table ordens_servico add constraint ordens_servico_status_check
  check (status in ('orcamento','a_fazer','em_andamento','pausada','concluido','faturada','cancelado'));

alter table ordens_servico add column if not exists responsavel_id uuid references perfis(id) on delete set null;
alter table ordens_servico add column if not exists motivo_pausa   text check (motivo_pausa in ('material','cliente','clima','equipe','outro'));
alter table ordens_servico add column if not exists pausa_obs      text;
alter table ordens_servico add column if not exists status_desde   timestamptz not null default now();
create index if not exists idx_os_responsavel on ordens_servico(responsavel_id) where responsavel_id is not null;

-- 2) Acompanhantes e histórico -----------------------------------------------------------
create table if not exists os_acompanhantes (
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  perfil_id             uuid not null references perfis(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  adicionado_por        uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now(),
  primary key (os_id, perfil_id)
);
select _aplicar_acesso('os_acompanhantes', '{os}', '{os}');

create table if not exists os_historico (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id),
  os_id                 uuid not null references ordens_servico(id) on delete cascade,
  de                    text,
  para                  text not null,
  motivo                text,
  obs                   text,
  usuario_id            uuid references perfis(id) on delete set null default auth.uid(),
  data                  timestamptz not null default now()
);
create index if not exists idx_os_historico on os_historico(os_id, data desc);
alter table os_historico enable row level security;
drop policy if exists os_historico_ler on os_historico;
create policy os_historico_ler on os_historico for select
  using (empresa_consultora_id = (select auth_empresa_id()) and (select pode('{os}'::text[], 'ver')));
-- sem policy de escrita: só o gatilho grava

-- 3) Avisos ligados à OS ------------------------------------------------------------------
alter table notificacoes add column if not exists os_id uuid references ordens_servico(id) on delete cascade;
alter table notificacoes drop constraint if exists notificacoes_tipo_check;
alter table notificacoes add constraint notificacoes_tipo_check
  check (tipo in ('atribuida','mencao','comentario','concluida','acompanhar','os_atribuida','os_status'));

create or replace function _notificar_os(p_dest uuid, p_tipo text, p_os uuid, p_texto text, p_ator uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := (select empresa_consultora_id from ordens_servico where id = p_os);
begin
  if p_dest is null or (p_ator is not null and p_dest = p_ator) then return; end if;
  if not exists (select 1 from perfis where id = p_dest and empresa_consultora_id = v_emp and ativo) then return; end if;
  insert into notificacoes (empresa_consultora_id, destinatario_id, ator_id, tipo, os_id, texto)
  values (v_emp, p_dest, p_ator, p_tipo, p_os, p_texto);
end $$;
revoke execute on function _notificar_os(uuid, text, uuid, text, uuid) from public, anon, authenticated;

-- 4) Gatilhos -------------------------------------------------------------------------------
-- antes de gravar: data da troca, data de realização, motivo só quando pausada
create or replace function _os_antes()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_desde := now();
    if new.status = 'concluido' and new.data_realizado is null then new.data_realizado := current_date; end if;
    if new.status <> 'pausada' then new.motivo_pausa := null; new.pausa_obs := null; end if;
  end if;
  if new.status = 'pausada' and new.motivo_pausa is null then
    raise exception 'Informe o motivo da pausa (material, cliente, clima, equipe ou outro)';
  end if;
  return new;
end $$;
drop trigger if exists trg_os_antes on ordens_servico;
create trigger trg_os_antes before insert or update on ordens_servico
  for each row execute function _os_antes();

-- depois de gravar: histórico + avisos
create or replace function _os_depois()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rot text := concat_ws(' · ', new.numero, new.titulo);
  v_id  uuid;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into os_historico (empresa_consultora_id, os_id, de, para, motivo, obs)
    values (new.empresa_consultora_id, new.id, case when tg_op = 'UPDATE' then old.status end,
            new.status, new.motivo_pausa, new.pausa_obs);
  end if;

  if new.responsavel_id is not null and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id) then
    perform _notificar_os(new.responsavel_id, 'os_atribuida', new.id, v_rot, auth.uid());
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    for v_id in
      select distinct x from (
        select new.responsavel_id as x
        union select perfil_id from os_acompanhantes where os_id = new.id
      ) s where x is not null
    loop
      perform _notificar_os(v_id, 'os_status', new.id,
        v_rot || ' → ' || new.status || coalesce(' (' || new.motivo_pausa || ')', ''), auth.uid());
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_os_depois on ordens_servico;
create trigger trg_os_depois after insert or update of status, responsavel_id on ordens_servico
  for each row execute function _os_depois();

-- incluído como acompanhante da OS
create or replace function _os_acompanhante_aviso()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rot text := (select concat_ws(' · ', numero, titulo) from ordens_servico where id = new.os_id);
begin
  perform _notificar_os(new.perfil_id, 'acompanhar', new.os_id, v_rot, auth.uid());
  return new;
end $$;
drop trigger if exists trg_os_acompanhante_aviso on os_acompanhantes;
create trigger trg_os_acompanhante_aviso after insert on os_acompanhantes
  for each row execute function _os_acompanhante_aviso();

-- 5) Histórico inicial: cada OS existente ganha um registro do status atual ---------------------
insert into os_historico (empresa_consultora_id, os_id, de, para, obs, usuario_id, data)
select o.empresa_consultora_id, o.id, null, o.status, 'situação na implantação do histórico', null, now()
  from ordens_servico o
 where not exists (select 1 from os_historico h where h.os_id = o.id);
