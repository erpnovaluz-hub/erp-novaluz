-- =============================================================================
-- CRM/ERP NOVALUZ — 0044 Tarefas: data de início (V3 · Etapa 5 — Timeline)
--
-- Timeline/Gantt desenha a barra de "inicio" até "prazo". Sem início, a barra
-- ocupa só o dia do prazo.
-- vw_tarefas é recriada: a view antiga congelou as colunas de 0041 e não tinha
-- origem/automacao_chave (0043) nem inicio.
--
-- Depende de 0041/0043.
-- =============================================================================

alter table tarefas add column if not exists inicio date;

drop view if exists vw_tarefas;
create view vw_tarefas as
  select t.*,
         (select count(*) from tarefas s where s.parent_id = t.id)                  as n_sub,
         (select count(*) from tarefas s where s.parent_id = t.id and s.concluida)  as n_sub_ok
    from tarefas t;
alter view vw_tarefas set (security_invoker = on);
revoke all on vw_tarefas from anon;
grant select on vw_tarefas to authenticated;

create index if not exists idx_tarefas_concluida_em on tarefas(empresa_consultora_id, concluida_em) where concluida;
