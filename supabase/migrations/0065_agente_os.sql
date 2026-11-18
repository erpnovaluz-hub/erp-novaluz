-- =============================================================================
-- CRM/ERP NOVALUZ — 0065 Agente · Fase 2: ações de OS com confirmação (amarela)
--
-- agente_os(p_acao, p): UMA função SECURITY INVOKER (roda com os direitos de
-- quem chama → o RLS/pode() continua valendo; o almoxarifado, que só tem
-- os=ver, é barrado aqui mesmo). Ela liga o marcador de sessão app.via_agente e
-- faz a mutação; os gatilhos de OS, lendo o marcador, carimbam "via assistente"
-- no os_historico. Devolve os ids afetados (para o log e o Desfazer).
--
-- Observação: os_historico só registra criação e troca de status. Prazo e
-- responsável não geram linha de histórico (é assim no 0051); a auditoria
-- desses fica em acoes_agente. Apontamento e insumo idem.
--
-- Depende de 0016/0051/0052/0054 (OS) e 0063 (tabelas do agente).
-- =============================================================================

-- 1) Marcador "via assistente" no histórico de OS -----------------------------
create or replace function _os_depois()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rot text := concat_ws(' · ', new.numero, new.titulo);
  v_id  uuid;
  v_marca text := case when current_setting('app.via_agente', true) = 'on' then 'via assistente' end;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into os_historico (empresa_consultora_id, os_id, de, para, motivo, obs)
    values (new.empresa_consultora_id, new.id, case when tg_op = 'UPDATE' then old.status end,
            new.status, new.motivo_pausa, nullif(concat_ws(' · ', new.pausa_obs, v_marca), ''));
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

-- 2) Dispatcher das ações de OS do agente (invoker) ---------------------------
-- p_acao: criar | status | prazo | responsavel | apontamento | insumo | concluir
-- Devolve jsonb com os ids afetados. Validações de RLS ficam a cargo do banco.
create or replace function agente_os(p_acao text, p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_emp uuid := auth_empresa_id();
  v_id  uuid;
begin
  perform set_config('app.via_agente', 'on', true);

  if p_acao = 'criar' then
    insert into ordens_servico (titulo, cliente_id, motivo, local, prazo, responsavel_id, urgencia, custo_estimado, status)
    values (p->>'titulo', nullif(p->>'cliente_id','')::uuid, nullif(p->>'motivo',''), nullif(p->>'local',''),
            nullif(p->>'prazo','')::date, nullif(p->>'responsavel_id','')::uuid,
            nullif(p->>'urgencia',''), coalesce(nullif(p->>'custo_estimado','')::numeric, 0),
            coalesce(nullif(p->>'status',''), 'a_fazer'))
    returning id into v_id;
    return jsonb_build_object('os_id', v_id);

  elsif p_acao = 'status' then
    update ordens_servico
       set status = p->>'status',
           motivo_pausa = nullif(p->>'motivo_pausa',''),
           pausa_obs = nullif(p->>'pausa_obs','')
     where id = (p->>'os_id')::uuid;
    return jsonb_build_object('os_id', p->>'os_id');

  elsif p_acao = 'concluir' then
    update ordens_servico set status = 'concluido' where id = (p->>'os_id')::uuid;
    return jsonb_build_object('os_id', p->>'os_id');

  elsif p_acao = 'prazo' then
    update ordens_servico set prazo = nullif(p->>'prazo','')::date where id = (p->>'os_id')::uuid;
    return jsonb_build_object('os_id', p->>'os_id');

  elsif p_acao = 'responsavel' then
    update ordens_servico set responsavel_id = nullif(p->>'responsavel_id','')::uuid where id = (p->>'os_id')::uuid;
    return jsonb_build_object('os_id', p->>'os_id');

  elsif p_acao = 'apontamento' then
    insert into os_apontamentos (os_id, atividade_id, colaborador_id, data, horas, tipo, observacao)
    values ((p->>'os_id')::uuid, nullif(p->>'atividade_id','')::uuid, (p->>'colaborador_id')::uuid,
            coalesce(nullif(p->>'data','')::date, current_date), (p->>'horas')::numeric,
            coalesce(nullif(p->>'tipo',''), 'normal'), nullif(p->>'observacao',''))
    returning id into v_id;
    return jsonb_build_object('apontamento_id', v_id);

  elsif p_acao = 'insumo' then
    insert into insumos_os (os_id, produto_id, descricao, quantidade, custo_unitario)
    values ((p->>'os_id')::uuid, nullif(p->>'produto_id','')::uuid, p->>'descricao',
            coalesce(nullif(p->>'quantidade','')::numeric, 1), coalesce(nullif(p->>'custo_unitario','')::numeric, 0))
    returning id into v_id;
    return jsonb_build_object('insumo_id', v_id);

  else
    raise exception 'Ação de OS desconhecida: %', p_acao;
  end if;
end $$;

grant execute on function agente_os(text, jsonb) to authenticated;
