-- =============================================================================
-- CRM/ERP NOVALUZ — 0061 Agendamento das automações (pg_cron) · Fase 0 do agente
--
-- Tira o motor de automações (rodar_automacoes_todas) da dependência de alguém
-- abrir o dashboard: passa a rodar sozinho, 2x por dia, para TODAS as empresas
-- com automação ligada. É idempotente — rodar de novo só reagenda.
--
-- Fuso de Fortaleza (America/Fortaleza, UTC-3, sem horário de verão):
--   07:00 Fortaleza = 10:00 UTC   ·   17:30 Fortaleza = 20:30 UTC
-- (pg_cron agenda sempre em UTC)
--
-- ATENÇÃO: as automações começam DESLIGADAS em cada empresa. Este cron só terá
-- efeito depois de ligá-las em /tarefas/automacoes. Enquanto nenhuma estiver
-- ativa, rodar_automacoes_todas() simplesmente não cria nada.
--
-- As rondas de IA (Maestro e Sentinela) NÃO entram aqui: elas precisam do app
-- (chave do Claude no servidor) e ganham seu próprio gatilho na Fase 3, via
-- pg_cron + pg_net batendo numa rota protegida — mesmo padrão do push (0050).
-- =============================================================================

create extension if not exists pg_cron;
-- Se o comando acima falhar por permissão, habilite o pg_cron em
-- Supabase → Database → Extensions e rode esta migration de novo.

-- Remove agendamentos antigos de mesmo nome (idempotência) --------------------
select cron.unschedule(jobid)
  from cron.job
 where jobname in ('novaluz_automacoes_manha', 'novaluz_automacoes_tarde');

-- Agenda os dois horários -----------------------------------------------------
select cron.schedule('novaluz_automacoes_manha', '0 10 * * *',
                     $$ select public.rodar_automacoes_todas(); $$);
select cron.schedule('novaluz_automacoes_tarde', '30 20 * * *',
                     $$ select public.rodar_automacoes_todas(); $$);

-- Conferência (opcional): os dois jobs devem aparecer aqui --------------------
-- select jobname, schedule, active from cron.job
--  where jobname like 'novaluz_automacoes_%';
