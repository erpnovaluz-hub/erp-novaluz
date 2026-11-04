-- =============================================================================
-- CRM/ERP NOVALUZ — 0067 OS ligada à obra (cadastro obras_servicos)
--
-- A OS ganha o campo "Obra". Tarefas vinculadas à obra passam a aparecer na
-- OS e vice-versa (feito no app, sem trigger).
-- =============================================================================

alter table ordens_servico
  add column if not exists obra_id uuid references obras_servicos(id) on delete set null;

create index if not exists idx_os_obra on ordens_servico(obra_id) where obra_id is not null;

-- Liga a OS-2026-0007 (KFC Iguatemi) à obra "Loja KFC Iguatemi".
update ordens_servico
   set obra_id = '80bb8955-f76a-4179-8e66-09cbab38fbdf'
 where id = (select id from ordens_servico where numero = 'OS-2026-0007' limit 1)
   and obra_id is null
   and exists (select 1 from obras_servicos where id = '80bb8955-f76a-4179-8e66-09cbab38fbdf');
