-- =============================================================================
-- CRM/ERP NOVALUZ — 0072 Ritmo de Gestão · Bloco 3: chat de gestão
-- (spec: docs/ritmo-gestao/bloco3-spec.md)
--
-- O chat de gestão é o mesmo Assistente com outra persona e outras
-- ferramentas. Aqui só:
--   * agente_conversas.modo  — 'geral' | 'gestao' (não misturar históricos)
--   * premissa modelo_gestao — Sonnet 5.5 só no modo gestão (trocável)
-- As ferramentas usam o RLS e as RPCs dos Blocos 1 (0070) e 2 (0071).
-- =============================================================================

alter table agente_conversas add column if not exists modo text not null default 'geral';
alter table agente_conversas drop constraint if exists agente_conversas_modo_check;
alter table agente_conversas add constraint agente_conversas_modo_check check (modo in ('geral','gestao'));

-- Conversa de gestão pode tratar de reunião confidencial: só o próprio autor lê
-- (as conversas gerais seguem legíveis pela gerência, como na 0063).
drop policy if exists agente_conversas_ler on agente_conversas;
create policy agente_conversas_ler on agente_conversas for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and (usuario_id = (select auth.uid()) or ((select is_gerente()) and modo <> 'gestao')));

drop policy if exists agente_mensagens_ler on agente_mensagens;
create policy agente_mensagens_ler on agente_mensagens for select
  using (empresa_consultora_id = (select auth_empresa_id())
         and exists (select 1 from agente_conversas c
                      where c.id = conversa_id
                        and (c.usuario_id = (select auth.uid()) or ((select is_gerente()) and c.modo <> 'gestao'))));

insert into premissas_agente (empresa_consultora_id, chave, valor)
select e.id, 'modelo_gestao', 'claude-sonnet-5-5'
  from empresas_consultoras e
    on conflict (empresa_consultora_id, chave) do nothing;
