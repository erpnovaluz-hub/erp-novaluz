-- =============================================================================
-- CRM/ERP NOVALUZ — 0041 Tarefas (V3 · Etapa 2 — "Asana interno")
--
-- projetos → secoes → tarefas (+ subtarefas via parent_id)
-- Visibilidade:
--   projeto público  → todos da empresa
--   projeto privado  → dono + gerência
--   tarefa           → quem vê o projeto, o responsável e quem criou
--                      (tarefa sem projeto = pessoal: criador, responsável, gerência)
-- Toda tarefa pode apontar para um registro do ERP (vinculo_tipo/vinculo_id).
-- vinculo_rotulo guarda o texto ("OS-2026-0012 · Cliente X") para quem não
-- tem acesso ao módulo ainda entender do que se trata.
--
-- Depende de 0040 (is_gerente, auth_empresa_id com ativo).
-- =============================================================================

-- 1) Tabelas ------------------------------------------------------------------
create table if not exists projetos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  nome                  text not null,
  descricao             text,
  cor                   text not null default 'teal',
  privado               boolean not null default false,
  dono_id               uuid references perfis(id) on delete set null default auth.uid(),
  arquivado             boolean not null default false,
  criado_em             timestamptz not null default now()
);

create table if not exists secoes_projeto (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  projeto_id            uuid not null references projetos(id) on delete cascade,
  nome                  text not null,
  ordem                 int  not null default 0,
  criado_em             timestamptz not null default now()
);

create table if not exists tarefas (
  id                    uuid primary key default gen_random_uuid(),
  empresa_consultora_id uuid not null references empresas_consultoras(id) default auth_empresa_id(),
  projeto_id            uuid references projetos(id) on delete cascade,
  secao_id              uuid references secoes_projeto(id) on delete set null,
  parent_id             uuid references tarefas(id) on delete cascade,
  titulo                text not null,
  descricao             text,
  responsavel_id        uuid references perfis(id) on delete set null,
  criado_por            uuid references perfis(id) on delete set null default auth.uid(),
  prazo                 date,
  prioridade            text not null default 'media' check (prioridade in ('baixa','media','alta','urgente')),
  concluida             boolean not null default false,
  concluida_em          timestamptz,
  ordem                 double precision not null default 0,
  vinculo_tipo          text check (vinculo_tipo in
                          ('os','obra','cliente','oportunidade','proposta','titulo','requisicao','pedido')),
  vinculo_id            uuid,
  vinculo_rotulo        text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

create index if not exists idx_projetos_empresa     on projetos(empresa_consultora_id) where not arquivado;
create index if not exists idx_secoes_projeto       on secoes_projeto(projeto_id, ordem);
create index if not exists idx_tarefas_projeto      on tarefas(projeto_id, secao_id, ordem);
create index if not exists idx_tarefas_responsavel  on tarefas(responsavel_id, concluida, prazo);
create index if not exists idx_tarefas_parent       on tarefas(parent_id);
create index if not exists idx_tarefas_vinculo      on tarefas(vinculo_tipo, vinculo_id);

-- 2) Regras de visibilidade --------------------------------------------------------
create or replace function pode_ver_projeto(p_projeto uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projetos p
     where p.id = p_projeto
       and p.empresa_consultora_id = auth_empresa_id()
       and (not p.privado or p.dono_id = auth.uid() or is_gerente()))
$$;

create or replace function pode_gerir_projeto(p_projeto uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projetos p
     where p.id = p_projeto
       and p.empresa_consultora_id = auth_empresa_id()
       and (p.dono_id = auth.uid() or is_gerente()))
$$;

grant execute on function pode_ver_projeto(uuid), pode_gerir_projeto(uuid) to authenticated;

-- projetos
alter table projetos enable row level security;
drop policy if exists projetos_ler on projetos;
drop policy if exists projetos_inserir on projetos;
drop policy if exists projetos_alterar on projetos;
drop policy if exists projetos_excluir on projetos;
create policy projetos_ler on projetos for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and (not privado or dono_id = (select auth.uid()) or (select is_gerente())));
create policy projetos_inserir on projetos for insert
  with check (empresa_consultora_id = (select auth_empresa_id()) and dono_id = (select auth.uid()));
create policy projetos_alterar on projetos for update
  using      (empresa_consultora_id = (select auth_empresa_id()) and (dono_id = (select auth.uid()) or (select is_gerente())))
  with check (empresa_consultora_id = (select auth_empresa_id()));
create policy projetos_excluir on projetos for delete
  using (empresa_consultora_id = (select auth_empresa_id()) and (dono_id = (select auth.uid()) or (select is_gerente())));

-- seções: quem vê o projeto organiza as seções
alter table secoes_projeto enable row level security;
drop policy if exists secoes_acesso on secoes_projeto;
create policy secoes_acesso on secoes_projeto for all
  using      (empresa_consultora_id = (select auth_empresa_id()) and pode_ver_projeto(projeto_id))
  with check (empresa_consultora_id = (select auth_empresa_id()) and pode_ver_projeto(projeto_id));

-- tarefas
create or replace function pode_ver_tarefa(p_projeto uuid, p_responsavel uuid, p_criador uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_responsavel = auth.uid()
      or p_criador = auth.uid()
      or is_gerente()
      or (p_projeto is not null and pode_ver_projeto(p_projeto))
$$;
grant execute on function pode_ver_tarefa(uuid, uuid, uuid) to authenticated;

alter table tarefas enable row level security;
drop policy if exists tarefas_ler on tarefas;
drop policy if exists tarefas_inserir on tarefas;
drop policy if exists tarefas_alterar on tarefas;
drop policy if exists tarefas_excluir on tarefas;
create policy tarefas_ler on tarefas for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and pode_ver_tarefa(projeto_id, responsavel_id, criado_por));
create policy tarefas_inserir on tarefas for insert
  with check (empresa_consultora_id = (select auth_empresa_id())
              and (projeto_id is null or pode_ver_projeto(projeto_id)));
create policy tarefas_alterar on tarefas for update
  using      (empresa_consultora_id = (select auth_empresa_id())
              and pode_ver_tarefa(projeto_id, responsavel_id, criado_por))
  with check (empresa_consultora_id = (select auth_empresa_id())
              and (projeto_id is null or pode_ver_projeto(projeto_id)
                   or responsavel_id = (select auth.uid()) or criado_por = (select auth.uid())));
-- excluir: quem criou, dono do projeto ou gerência
create policy tarefas_excluir on tarefas for delete
  using (empresa_consultora_id = (select auth_empresa_id())
         and (criado_por = (select auth.uid()) or (select is_gerente())
              or (projeto_id is not null and pode_gerir_projeto(projeto_id))));

-- 3) Gatilhos -------------------------------------------------------------------
-- projeto nasce com as seções padrão
create or replace function _secoes_padrao_projeto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into secoes_projeto (empresa_consultora_id, projeto_id, nome, ordem) values
    (new.empresa_consultora_id, new.id, 'A fazer', 1),
    (new.empresa_consultora_id, new.id, 'Em andamento', 2),
    (new.empresa_consultora_id, new.id, 'Concluído', 3);
  return new;
end $$;

drop trigger if exists trg_secoes_padrao on projetos;
create trigger trg_secoes_padrao after insert on projetos
  for each row execute function _secoes_padrao_projeto();

-- carimba concluída_em / atualizado_em; subtarefa herda o projeto da mãe
create or replace function _tarefa_carimbos()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if new.concluida and (tg_op = 'INSERT' or not old.concluida) then
    new.concluida_em := now();
  elsif not new.concluida then
    new.concluida_em := null;
  end if;
  if new.parent_id is not null and new.projeto_id is null then
    select projeto_id into new.projeto_id from tarefas where id = new.parent_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_tarefa_carimbos on tarefas;
create trigger trg_tarefa_carimbos before insert or update on tarefas
  for each row execute function _tarefa_carimbos();

-- 4) Resumo de subtarefas (lista/quadro mostram "2/5") ---------------------------
create or replace view vw_tarefas as
  select t.*,
         (select count(*) from tarefas s where s.parent_id = t.id)                  as n_sub,
         (select count(*) from tarefas s where s.parent_id = t.id and s.concluida)  as n_sub_ok
    from tarefas t;
alter view vw_tarefas set (security_invoker = on);
revoke all on vw_tarefas from anon;
grant select on vw_tarefas to authenticated;
