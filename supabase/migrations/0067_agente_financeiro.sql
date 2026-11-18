-- =============================================================================
-- CRM/ERP NOVALUZ — 0067 Agente · CFO Digital (F0 leitura + F1 controle de caixa)
--
-- agente_financeiro(p_acao, p): UMA função SECURITY INVOKER (roda com os
-- direitos de quem chama → o RLS/pode() continua valendo; só quem tem
-- financeiro=editar cria/altera título aqui). Cria APENAS título 'aberto'
-- (previsão) e reagenda vencimento — NÃO dá baixa, NÃO mexe em saldo (isso é
-- fase vermelha). Devolve os ids afetados (log + Desfazer).
--
-- Também: premissas padrão do resumo financeiro e o cron semanal (seg 10:00
-- UTC = 07:00 Fortaleza) que dispara /api/agente/rondas com momento=financeiro.
--
-- Depende de 0006 (financeiro), 0050 (pg_net/config_sistema), 0061 (pg_cron),
-- 0063 (premissas) e 0066 (_disparar_ronda).
-- =============================================================================

-- 1) Dispatcher financeiro do agente (invoker) --------------------------------
-- p_acao: criar_titulo | vencimento
create or replace function agente_financeiro(p_acao text, p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  if p_acao = 'criar_titulo' then
    -- cria SEMPRE 'aberto' (previsão); baixa é ação vermelha, fora daqui
    insert into titulos_financeiros
      (tipo, descricao, valor, vencimento, categoria_id, cliente_id, fornecedor_id, status, origem)
    values
      (p->>'tipo', p->>'descricao', (p->>'valor')::numeric, nullif(p->>'vencimento','')::date,
       nullif(p->>'categoria_id','')::uuid, nullif(p->>'cliente_id','')::uuid,
       nullif(p->>'fornecedor_id','')::uuid, 'aberto', 'manual')
    returning id into v_id;
    return jsonb_build_object('titulo_id', v_id);

  elsif p_acao = 'vencimento' then
    update titulos_financeiros
       set vencimento = nullif(p->>'vencimento','')::date
     where id = (p->>'titulo_id')::uuid and status = 'aberto';
    return jsonb_build_object('titulo_id', p->>'titulo_id');

  else
    raise exception 'Ação financeira desconhecida: %', p_acao;
  end if;
end $$;

grant execute on function agente_financeiro(text, jsonb) to authenticated;

-- 2) Premissas padrão do resumo financeiro por empresa ------------------------
insert into premissas_agente (empresa_consultora_id, chave, valor)
select e.id, v.chave, v.valor
  from empresas_consultoras e
 cross join (values
   ('resumo_financeiro_ativo', 'true'),
   ('meses_runway_alerta', '3')
 ) as v(chave, valor)
 on conflict (empresa_consultora_id, chave) do nothing;

-- 3) Agendamento do resumo financeiro semanal (idempotente) -------------------
-- segunda 10:00 UTC = 07:00 Fortaleza (UTC-3)
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'agente_financeiro_semana';
select cron.schedule('agente_financeiro_semana', '0 10 * * 1', $$ select public._disparar_ronda('financeiro') $$);
