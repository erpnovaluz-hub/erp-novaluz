-- =============================================================================
-- CRM/ERP NOVALUZ — 0064 RPC agente_notificar (Fase 1 do Funcionário Digital)
--
-- notificacoes só é gravada por gatilhos (não há policy de INSERT). A ferramenta
-- verde "notificar_usuario" do chat precisa, então, de uma função definer que
-- valida o destinatário (mesma empresa e ativo) e grava — reusando o padrão de
-- _notificar (0042). As demais ferramentas verdes de tarefa (criar/atualizar/
-- vincular/concluir/comentar) NÃO precisam de RPC: rodam como operações diretas
-- sob o RLS do usuário, que é justamente a trava de permissão da Fase 1.
--
-- O push (0050) dispara sozinho: todo INSERT em notificacoes já tem gatilho.
-- Depende de 0042 (notificacoes, _notificar) e 0051 (os_id, tipos de OS).
-- =============================================================================

-- novo tipo para avisos do assistente
alter table notificacoes drop constraint if exists notificacoes_tipo_check;
alter table notificacoes add constraint notificacoes_tipo_check
  check (tipo in ('atribuida','mencao','comentario','concluida','acompanhar',
                  'os_atribuida','os_status','agente'));

-- aviso do agente: 1 notificação validada (dest na mesma empresa e ativo)
-- p_os / p_tarefa opcionais, só para dar o link de origem no app.
create or replace function agente_notificar(p_dest uuid, p_texto text,
                                            p_tarefa uuid default null, p_os uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := auth_empresa_id();
  v_id  uuid;
begin
  if v_emp is null then raise exception 'Usuário sem empresa'; end if;
  if p_dest is null then raise exception 'Informe o destinatário'; end if;
  if nullif(trim(p_texto), '') is null then raise exception 'Informe o texto do aviso'; end if;
  if not exists (select 1 from perfis where id = p_dest and empresa_consultora_id = v_emp and ativo) then
    raise exception 'Destinatário não encontrado na empresa';
  end if;
  if p_dest = auth.uid() then return null; end if;   -- não avisa a si mesmo

  insert into notificacoes (empresa_consultora_id, destinatario_id, ator_id, tipo, tarefa_id, os_id, texto)
  values (v_emp, p_dest, auth.uid(), 'agente', p_tarefa, p_os, left(p_texto, 280))
  returning id into v_id;
  return v_id;
end $$;

grant execute on function agente_notificar(uuid, text, uuid, uuid) to authenticated;
