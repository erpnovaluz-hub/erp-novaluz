-- =============================================================================
-- CRM/ERP NOVALUZ — 0042 Tarefas: colaboração (V3 · Etapa 3)
--
-- tarefa_comentarios  conversa na tarefa, com @menções (mencoes uuid[])
-- notificacoes        caixa de entrada; criadas SÓ por gatilhos:
--                       atribuida  → alguém te passou uma tarefa
--                       mencao     → te marcaram com @ num comentário
--                       comentario → comentaram numa tarefa sua (criada/atribuída)
--                       concluida  → concluíram uma tarefa que você criou
-- tarefa_anexos       arquivos da tarefa no bucket privado "anexos"
--                     (caminho: <empresa_id>/<tarefa_id>/<arquivo>)
--
-- Quem vê a tarefa vê comentários e anexos (o RLS de tarefas vale dentro das
-- policies). Prazos vencendo não viram notificação gravada: a caixa de entrada
-- calcula na hora a partir das tarefas.
--
-- Depende de 0041 (tarefas).
-- =============================================================================

-- 1) Comentários -------------------------------------------------------------------
create table if not exists tarefa_comentarios (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  tarefa_id             uuid not null references tarefas(id) on delete cascade,
  autor_id              uuid references perfis(id) on delete set null default auth.uid(),
  texto                 text not null check (length(trim(texto)) > 0),
  mencoes               uuid[] not null default '{}',
  criado_em             timestamptz not null default now(),
  editado_em            timestamptz
);
create index if not exists idx_comentarios_tarefa on tarefa_comentarios(tarefa_id, criado_em);

alter table tarefa_comentarios enable row level security;
drop policy if exists comentarios_ler on tarefa_comentarios;
drop policy if exists comentarios_inserir on tarefa_comentarios;
drop policy if exists comentarios_alterar on tarefa_comentarios;
drop policy if exists comentarios_excluir on tarefa_comentarios;
create policy comentarios_ler on tarefa_comentarios for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and exists (select 1 from tarefas t where t.id = tarefa_id));
create policy comentarios_inserir on tarefa_comentarios for insert
  with check (empresa_consultora_id = (select auth_empresa_id())
              and autor_id = (select auth.uid())
              and exists (select 1 from tarefas t where t.id = tarefa_id));
create policy comentarios_alterar on tarefa_comentarios for update
  using      (autor_id = (select auth.uid()))
  with check (autor_id = (select auth.uid()));
create policy comentarios_excluir on tarefa_comentarios for delete
  using (autor_id = (select auth.uid())
         or (empresa_consultora_id = (select auth_empresa_id()) and (select is_gerente())));

-- 2) Notificações -------------------------------------------------------------------
create table if not exists notificacoes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id),
  destinatario_id       uuid not null references perfis(id) on delete cascade,
  ator_id               uuid references perfis(id) on delete set null,
  tipo                  text not null check (tipo in ('atribuida','mencao','comentario','concluida')),
  tarefa_id             uuid references tarefas(id) on delete cascade,
  texto                 text,
  lida                  boolean not null default false,
  criado_em             timestamptz not null default now()
);
create index if not exists idx_notificacoes_dest on notificacoes(destinatario_id, lida, criado_em desc);

alter table notificacoes enable row level security;
drop policy if exists notificacoes_ler on notificacoes;
drop policy if exists notificacoes_marcar on notificacoes;
drop policy if exists notificacoes_excluir on notificacoes;
-- sem policy de insert: só os gatilhos (security definer) criam notificações
create policy notificacoes_ler on notificacoes for select
  using (destinatario_id = (select auth.uid()));
create policy notificacoes_marcar on notificacoes for update
  using (destinatario_id = (select auth.uid())) with check (destinatario_id = (select auth.uid()));
create policy notificacoes_excluir on notificacoes for delete
  using (destinatario_id = (select auth.uid()));

-- cria 1 notificação (ignora: sem destinatário, a própria pessoa, outra empresa, inativo)
create or replace function _notificar(p_dest uuid, p_tipo text, p_tarefa uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  if p_dest is null or p_dest = auth.uid() then return; end if;
  select empresa_consultora_id into v_emp from tarefas where id = p_tarefa;
  if not exists (select 1 from perfis where id = p_dest and empresa_consultora_id = v_emp and ativo) then return; end if;
  insert into notificacoes (empresa_consultora_id, destinatario_id, ator_id, tipo, tarefa_id, texto)
  values (v_emp, p_dest, auth.uid(), p_tipo, p_tarefa, p_texto);
end $$;

-- tarefa: atribuição e conclusão
create or replace function _notificar_tarefa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.responsavel_id is not null
     and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id) then
    perform _notificar(new.responsavel_id, 'atribuida', new.id, new.titulo);
  end if;
  if tg_op = 'UPDATE' and new.concluida and not old.concluida
     and new.criado_por is distinct from new.responsavel_id then
    perform _notificar(new.criado_por, 'concluida', new.id, new.titulo);
  end if;
  return new;
end $$;

drop trigger if exists trg_notificar_tarefa on tarefas;
create trigger trg_notificar_tarefa after insert or update of responsavel_id, concluida on tarefas
  for each row execute function _notificar_tarefa();

-- comentário: menções + envolvidos na tarefa
create or replace function _notificar_comentario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_t   tarefas%rowtype;
  v_ids uuid[];
  v_id  uuid;
  v_txt text := left(new.texto, 140);
begin
  select * into v_t from tarefas where id = new.tarefa_id;
  foreach v_id in array coalesce(new.mencoes, '{}') loop
    perform _notificar(v_id, 'mencao', new.tarefa_id, v_txt);
  end loop;
  -- responsável e criador (sem repetir, e sem quem já foi avisado pela menção)
  select array_agg(distinct x) into v_ids
    from unnest(array[v_t.responsavel_id, v_t.criado_por]) x
   where x is not null and not (x = any (coalesce(new.mencoes, '{}')));
  foreach v_id in array coalesce(v_ids, '{}') loop
    perform _notificar(v_id, 'comentario', new.tarefa_id, v_txt);
  end loop;
  return new;
end $$;

drop trigger if exists trg_notificar_comentario on tarefa_comentarios;
create trigger trg_notificar_comentario after insert on tarefa_comentarios
  for each row execute function _notificar_comentario();

-- 3) Anexos ------------------------------------------------------------------------
create table if not exists tarefa_anexos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  tarefa_id             uuid not null references tarefas(id) on delete cascade,
  caminho               text not null unique,
  nome                  text not null,
  tamanho               bigint,
  tipo_mime             text,
  enviado_por           uuid references perfis(id) on delete set null default auth.uid(),
  criado_em             timestamptz not null default now()
);
create index if not exists idx_anexos_tarefa on tarefa_anexos(tarefa_id);

alter table tarefa_anexos enable row level security;
drop policy if exists anexos_ler on tarefa_anexos;
drop policy if exists anexos_inserir on tarefa_anexos;
drop policy if exists anexos_excluir on tarefa_anexos;
create policy anexos_ler on tarefa_anexos for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and exists (select 1 from tarefas t where t.id = tarefa_id));
create policy anexos_inserir on tarefa_anexos for insert
  with check (empresa_consultora_id = (select auth_empresa_id())
              and enviado_por = (select auth.uid())
              and exists (select 1 from tarefas t where t.id = tarefa_id));
create policy anexos_excluir on tarefa_anexos for delete
  using (empresa_consultora_id = (select auth_empresa_id())
         and (enviado_por = (select auth.uid()) or (select is_gerente())));

-- bucket privado (download por URL assinada), limite de 20 MB por arquivo
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

-- a 1ª pasta do caminho é a empresa: ninguém lê/grava arquivo de outra empresa
drop policy if exists anexos_obj_ler on storage.objects;
drop policy if exists anexos_obj_inserir on storage.objects;
drop policy if exists anexos_obj_excluir on storage.objects;
create policy anexos_obj_ler on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = auth_empresa_id()::text);
create policy anexos_obj_inserir on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and (storage.foldername(name))[1] = auth_empresa_id()::text);
create policy anexos_obj_excluir on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and (storage.foldername(name))[1] = auth_empresa_id()::text);

-- 4) Logos: envio só pelo admin central ---------------------------------------------
-- (0036 deixava qualquer usuário logado trocar o logo de qualquer empresa)
drop policy if exists logos_insert on storage.objects;
create policy logos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'logos' and is_super());
drop policy if exists logos_update on storage.objects;
create policy logos_update on storage.objects
  for update to authenticated using (bucket_id = 'logos' and is_super()) with check (bucket_id = 'logos' and is_super());
