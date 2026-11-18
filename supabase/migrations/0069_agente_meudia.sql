-- =============================================================================
-- CRM/ERP NOVALUZ — 0069 "O meu dia" · briefing pessoal diário (push de manhã)
--
-- Toda manhã cada pessoa ATIVA recebe um resumo só dela (tarefas e OS sob sua
-- responsabilidade). O DONO (gestor) recebe também a visão de gestão. A entrega
-- é uma notificação por pessoa — o gatilho de push (0050) dispara o aviso no
-- celular. Reusa _disparar_ronda (0066) + rota /api/agente/rondas (momento
-- 'meudia'); o app (service role + chave do Claude) faz o trabalho.
--
-- Fuso Fortaleza (UTC-3): 06:50 = 09:50 UTC (pg_cron agenda em UTC).
--
-- Depende de 0066 (_disparar_ronda, pg_cron, premissas), 0050 (push).
-- =============================================================================

-- 1) Premissa por empresa (liga/desliga o briefing pessoal) --------------------
insert into premissas_agente (empresa_consultora_id, chave, valor)
select e.id, 'meudia_ativa', 'true'
  from empresas_consultoras e
 on conflict (empresa_consultora_id, chave) do nothing;

-- 2) Agendamento (idempotente): 06:50 Fortaleza = 09:50 UTC, todos os dias ------
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'agente_meudia';
select cron.schedule('agente_meudia', '50 9 * * *', $$ select public._disparar_ronda('meudia') $$);

-- Conferência (opcional):
-- select jobname, schedule, active from cron.job where jobname = 'agente_meudia';
