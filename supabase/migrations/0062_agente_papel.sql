-- =============================================================================
-- CRM/ERP NOVALUZ — 0062 Papel "agente" (Fase 1 do Funcionário Digital)
--
-- Novo papel de perfil: agente. Usado pelo USUÁRIO-AGENTE das rondas (Maestro e
-- Sentinela, Fase 3). O chat NÃO usa este papel — ele age com a identidade de
-- quem conversa. O agente lê OS e produção; não tem financeiro, compras, estoque
-- nem RH. Criar tarefas/notificações passa pelo RLS de tarefas e por RPC definer
-- (0064), não pelo pode().
--
-- Espelha src/lib/permissoes.ts (nivelPadrao). Depende de 0040.
-- =============================================================================

alter table perfis drop constraint if exists perfis_papel_check;
alter table perfis add constraint perfis_papel_check
  check (papel in ('super','admin','almoxarifado','logistica','agente'));

-- padrão de fábrica por módulo (igual ao TS); agente só enxerga OS e produção
create or replace function nivel_padrao(p_papel text, p_modulo text)
returns text language sql immutable as $$
  select case
    when p_papel in ('super','admin') then 'editar'
    when p_papel = 'almoxarifado' then case p_modulo
      when 'estoque'     then 'editar'
      when 'requisicoes' then 'editar'
      when 'compras'     then 'editar'
      when 'os'          then 'ver'
      when 'producao'    then 'ver'
      else 'nenhum' end
    when p_papel = 'logistica' then case p_modulo
      when 'os'          then 'editar'
      when 'requisicoes' then 'editar'
      when 'estoque'     then 'ver'
      when 'producao'    then 'ver'
      else 'nenhum' end
    when p_papel = 'agente' then case p_modulo
      when 'os'          then 'ver'
      when 'producao'    then 'ver'
      else 'nenhum' end
    else 'nenhum'
  end
$$;

-- is_gerente() continua falso para agente (ele não é gerência).
-- permissoes_papel segue só para almoxarifado/logistica: agente usa nivel_padrao.
