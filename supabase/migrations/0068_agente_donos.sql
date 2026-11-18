-- =============================================================================
-- CRM/ERP NOVALUZ — 0068 Agente · donos (tiering por login)
--
-- O assistente passa a diferenciar quem conversa:
--   • DONO  → conversa mais profunda e PODE executar ações (as "determinações").
--   • demais → modo CONSULTA (só leitura).
--
-- Quem é dono é decidido por E-MAIL (login), numa premissa configurável.
-- Começa só com o Fernando (super). Para incluir/remover alguém, edite o valor
-- (e-mails separados por vírgula). Se a premissa ficar vazia, o app cai no
-- fallback de código: apenas o papel 'super' é dono.
--
-- A trava real é no servidor (o executor recusa ação de quem não é dono e o
-- modelo nem recebe as ferramentas de ação) — não só no menu, porque quase
-- todos os usuários são 'admin' e o RLS não os limitaria.
--
-- Depende de 0063 (premissas_agente).
-- =============================================================================
insert into premissas_agente (empresa_consultora_id, chave, valor)
select e.id, 'agente_donos', 'tec.fernandoluz01@gmail.com'
  from empresas_consultoras e
 on conflict (empresa_consultora_id, chave) do nothing;
