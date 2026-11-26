-- =============================================================================
-- CRM/ERP NOVALUZ — 0075 Agente · quem pode LANÇAR pelo chat
--
-- Novo nível entre o dono e a consulta: o "lançador". Quem está na premissa
-- agente_lancadores (e-mails, por empresa) pode, pelo chat do Assistente,
-- anexar comprovante/boleto/NF ou pedir por texto e receber os cartões de
-- lançamento (criar título, reagendar vencimento, dar baixa, lançar pago) —
-- e confirmar os PRÓPRIOS cartões. Continua valendo o RLS: a pessoa precisa
-- ter o módulo financeiro com edição.
--
-- O dono marca quem pode na tela /assistente/acessos (grava pelo servidor).
--
-- Trava: antes, qualquer gerente podia alterar qualquer premissa pela API —
-- inclusive agente_donos (virar dono). Agora agente_donos e agente_lancadores
-- só mudam pelo super ou pelo servidor (service role, que checa o dono).
--
-- Depende de 0063 (premissas_agente), 0068 (agente_donos), 0027 (is_super).
-- =============================================================================

insert into premissas_agente (empresa_consultora_id, chave, valor)
select e.id, 'agente_lancadores', ''
  from empresas_consultoras e
 on conflict (empresa_consultora_id, chave) do nothing;

drop policy if exists premissas_agente_gerir on premissas_agente;
create policy premissas_agente_gerir on premissas_agente for all
  using (
    empresa_consultora_id = (select auth_empresa_id())
    and (select is_gerente())
    and (chave not in ('agente_donos', 'agente_lancadores') or (select is_super()))
  )
  with check (
    empresa_consultora_id = (select auth_empresa_id())
    and (select is_gerente())
    and (chave not in ('agente_donos', 'agente_lancadores') or (select is_super()))
  );
