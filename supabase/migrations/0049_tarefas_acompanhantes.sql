-- =============================================================================
-- CRM/ERP NOVALUZ — 0049 Tarefas: acompanhantes (seguidores)
--
-- Uma tarefa tem 1 responsável e N acompanhantes. Acompanhante:
--   · vê a tarefa (inclusive em projeto privado) e pode comentar/anexar
--   · recebe aviso ao ser incluído, a cada comentário e quando a tarefa é concluída
--
-- e_acompanhante() é security definer: evita recursão entre as policies de
-- tarefas e de tarefa_acompanhantes.
-- Depende de 0041/0042/0043.
-- =============================================================================

create table if not exists tarefa_acompanhantes (
  tarefa_id             uuid not null references tarefas(id) on delete cascade,
  perfil_id             uuid not null references perfis(id) on delete cascade,
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  adicionado_por        uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now(),
  primary key (tarefa_id, perfil_id)
);
create index if not exists idx_acompanhantes_perfil on tarefa_acompanhantes(perfil_id);

create or replace function e_acompanhante(p_tarefa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tarefa_acompanhantes where tarefa_id = p_tarefa and perfil_id = auth.uid())
$$;
grant execute on function e_acompanhante(uuid) to authenticated;

-- visibilidade da tarefa passa a incluir os acompanhantes
drop policy if exists tarefas_ler on tarefas;
drop policy if exists tarefas_alterar on tarefas;
create policy tarefas_ler on tarefas for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and (pode_ver_tarefa(projeto_id, responsavel_id, criado_por) or e_acompanhante(id)));
create policy tarefas_alterar on tarefas for update
  using      (empresa_consultora_id = (select auth_empresa_id())
              and (pode_ver_tarefa(projeto_id, responsavel_id, criado_por) or e_acompanhante(id)))
  with check (empresa_consultora_id = (select auth_empresa_id())
              and (projeto_id is null or pode_ver_projeto(projeto_id)
                   or responsavel_id = (select auth.uid()) or criado_por = (select auth.uid()) or e_acompanhante(id)));

-- quem vê a tarefa vê e gerencia os acompanhantes; cada um pode sair sozinho
alter table tarefa_acompanhantes enable row level security;
drop policy if exists acomp_ler on tarefa_acompanhantes;
drop policy if exists acomp_inserir on tarefa_acompanhantes;
drop policy if exists acomp_excluir on tarefa_acompanhantes;
create policy acomp_ler on tarefa_acompanhantes for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and (perfil_id = (select auth.uid()) or exists (select 1 from tarefas t where t.id = tarefa_id)));
create policy acomp_inserir on tarefa_acompanhantes for insert
  with check (empresa_consultora_id = (select auth_empresa_id())
              and exists (select 1 from tarefas t where t.id = tarefa_id)
              and exists (select 1 from perfis p where p.id = perfil_id and p.empresa_consultora_id = (select auth_empresa_id()) and p.ativo));
create policy acomp_excluir on tarefa_acompanhantes for delete
  using (empresa_consultora_id = (select auth_empresa_id())
         and (perfil_id = (select auth.uid()) or exists (select 1 from tarefas t where t.id = tarefa_id)));

-- avisos ---------------------------------------------------------------------------------
alter table notificacoes drop constraint if exists notificacoes_tipo_check;
alter table notificacoes add constraint notificacoes_tipo_check
  check (tipo in ('atribuida','mencao','comentario','concluida','acompanhar'));

-- incluído como acompanhante (por outra pessoa)
create or replace function _notificar_acompanhante()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tit text;
begin
  select titulo into v_tit from tarefas where id = new.tarefa_id;
  perform _notificar_ator(new.perfil_id, 'acompanhar', new.tarefa_id, v_tit, auth.uid());
  return new;
end $$;
drop trigger if exists trg_notificar_acompanhante on tarefa_acompanhantes;
create trigger trg_notificar_acompanhante after insert on tarefa_acompanhantes
  for each row execute function _notificar_acompanhante();

-- conclusão avisa o criador e os acompanhantes
create or replace function _notificar_tarefa()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ator uuid := case when new.origem = 'automacao' and tg_op = 'INSERT' then null else auth.uid() end;
  v_id   uuid;
begin
  if new.responsavel_id is not null
     and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id) then
    perform _notificar_ator(new.responsavel_id, 'atribuida', new.id, new.titulo, v_ator);
  end if;
  if tg_op = 'UPDATE' and new.concluida and not old.concluida then
    for v_id in
      select distinct x from (
        select new.criado_por as x
        union select perfil_id from tarefa_acompanhantes where tarefa_id = new.id
      ) s where x is not null and x is distinct from new.responsavel_id
    loop
      perform _notificar_ator(v_id, 'concluida', new.id, new.titulo, auth.uid());
    end loop;
  end if;
  return new;
end $$;

-- comentário avisa: mencionados (menção) · responsável, criador e acompanhantes (comentário)
create or replace function _notificar_comentario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_t   tarefas%rowtype;
  v_id  uuid;
  v_txt text := left(new.texto, 140);
begin
  select * into v_t from tarefas where id = new.tarefa_id;
  foreach v_id in array coalesce(new.mencoes, '{}') loop
    perform _notificar(v_id, 'mencao', new.tarefa_id, v_txt);
  end loop;
  for v_id in
    select distinct x from (
      select v_t.responsavel_id as x
      union select v_t.criado_por
      union select perfil_id from tarefa_acompanhantes where tarefa_id = new.tarefa_id
    ) s where x is not null and not (x = any (coalesce(new.mencoes, '{}')))
  loop
    perform _notificar(v_id, 'comentario', new.tarefa_id, v_txt);
  end loop;
  return new;
end $$;
