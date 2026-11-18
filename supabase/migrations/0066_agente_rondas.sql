-- =============================================================================
-- CRM/ERP NOVALUZ — 0066 Agente · Fase 3: rondas (Maestro + Sentinela)
--
-- As rondas precisam do app (chave do Claude no servidor), então o pg_cron só
-- DISPARA: faz net.http_post para /api/agente/rondas (protegida por segredo,
-- como o push). A rota roda a Sentinela + Maestro por empresa.
--
-- Fuso Fortaleza (UTC-3): briefing 07:00 = 10:00 UTC · resumo 17:30 = 20:30 UTC.
--
-- DEPOIS DE RODAR, configure (troque pelos seus valores):
--   insert into config_sistema (chave, valor) values
--     ('ronda_url',     'https://SEU-SITE.vercel.app/api/agente/rondas'),
--     ('ronda_segredo', 'o mesmo valor de RONDA_WEBHOOK_SECRET da Vercel')
--   on conflict (chave) do update set valor = excluded.valor;
--
-- Depende de 0050 (pg_net, config_sistema), 0061 (pg_cron), 0063 (premissas).
-- =============================================================================

-- 1) Premissas padrão por empresa ---------------------------------------------
insert into premissas_agente (empresa_consultora_id, chave, valor)
select e.id, v.chave, v.valor
  from empresas_consultoras e
 cross join (values
   ('ronda_ativa', 'true'),
   ('briefing_hora', '07:00'),
   ('resumo_hora', '17:30'),
   ('dias_pausada_cobra', '3'),
   ('dias_pausada_escala', '7'),
   ('dias_prazo_risco', '3'),
   ('dias_concluida_nao_faturada', '3')
 ) as v(chave, valor)
 on conflict (empresa_consultora_id, chave) do nothing;

-- 2) Disparo da ronda (lê a config e faz o POST) ------------------------------
create or replace function _disparar_ronda(p_momento text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select valor from config_sistema where chave = 'ronda_url');
  v_seg text := (select valor from config_sistema where chave = 'ronda_segredo');
begin
  if v_url is null or v_seg is null then return; end if;
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('momento', p_momento),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ronda-secret', v_seg));
end $$;
revoke execute on function _disparar_ronda(text) from public, anon, authenticated;

-- 3) Agendamento (idempotente) ------------------------------------------------
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname in ('agente_briefing', 'agente_resumo');
select cron.schedule('agente_briefing', '0 10 * * *',  $$ select public._disparar_ronda('briefing') $$);
select cron.schedule('agente_resumo',   '30 20 * * *', $$ select public._disparar_ronda('resumo') $$);
