-- =============================================================================
-- CRM NOVALUZ — SEED de exemplo (MSFORT / Impacto)
-- Rode DEPOIS de criar seu usuário no Supabase Auth e o perfil ligado ao tenant.
-- Ajuste o UUID do tenant abaixo (:tenant) ou rode via bloco que cria tudo.
-- =============================================================================

do $$
declare
  v_tenant  uuid;
  v_cli_imp uuid;   -- Impacto
  v_cli_met uuid;   -- Metalúrgica exemplo
  v_op1     uuid;
  v_prop1   uuid;
  v_ctr1    uuid;
  v_obra1   uuid;
  v_colab1  uuid;
begin
  -- tenant: usa o primeiro existente, ou cria "MSFORT"
  select id into v_tenant from empresas_consultoras limit 1;
  if v_tenant is null then
    insert into empresas_consultoras(nome, documento) values ('MSFORT', '00.000.000/0001-00')
    returning id into v_tenant;
  end if;

  -- clientes
  insert into clientes(empresa_consultora_id, nome, segmento, origem, status, responsavel_comercial, nivel_relacionamento)
  values (v_tenant, 'Impacto Construções', 'Construção civil', 'Indicação', 'ativo', 'Fernando', 'estrategico')
  returning id into v_cli_imp;

  insert into clientes(empresa_consultora_id, nome, segmento, origem, status, responsavel_comercial, nivel_relacionamento)
  values (v_tenant, 'Metalúrgica Alfa', 'Metalurgia', 'Site', 'ativo', 'Fernando', 'morno')
  returning id into v_cli_met;

  -- contatos
  insert into contatos(empresa_consultora_id, cliente_id, nome, cargo, telefone, email, e_decisor)
  values (v_tenant, v_cli_imp, 'Carlos Souza', 'Eng. de Obras', '(11) 90000-0001', 'carlos@impacto.com', true),
         (v_tenant, v_cli_met, 'Ana Lima', 'Compras', '(11) 90000-0002', 'ana@alfa.com', false);

  -- interações
  insert into interacoes(empresa_consultora_id, cliente_id, data, tipo, resumo, proximo_passo, responsavel)
  values (v_tenant, v_cli_imp, now() - interval '5 days', 'reuniao', 'Alinhamento de cimbramento', 'Enviar proposta de manutenção', 'Fernando'),
         (v_tenant, v_cli_met, now() - interval '40 days', 'whatsapp', 'Cotação de solda', 'Retomar contato', 'Fernando');

  -- oportunidade + proposta
  insert into oportunidades(empresa_consultora_id, cliente_id, titulo, valor_estimado, etapa, probabilidade, data_prevista_fechamento, origem)
  values (v_tenant, v_cli_imp, 'Manutenção recorrente de formas', 48000, 'proposta_enviada', 60, current_date + 20, 'Indicação')
  returning id into v_op1;

  insert into propostas(empresa_consultora_id, oportunidade_id, numero, valor, validade, status)
  values (v_tenant, v_op1, 'P-2026-001', 48000, current_date + 3, 'enviada')
  returning id into v_prop1;

  -- contrato + faturamento
  insert into contratos(empresa_consultora_id, cliente_id, proposta_id, numero, data_inicio, data_fim, tipo, valor, status)
  values (v_tenant, v_cli_imp, v_prop1, 'C-2026-001', current_date - 60, current_date + 25, 'recorrente', 48000, 'ativo')
  returning id into v_ctr1;

  insert into faturamento(empresa_consultora_id, contrato_id, cliente_id, competencia, valor_previsto, valor_realizado, status)
  values (v_tenant, v_ctr1, v_cli_imp, date_trunc('month', current_date)::date, 8000, 8000, 'pago'),
         (v_tenant, v_ctr1, v_cli_imp, (date_trunc('month', current_date) + interval '1 month')::date, 8000, null, 'previsto');

  -- tarefas
  insert into tarefas_followup(empresa_consultora_id, cliente_id, responsavel, descricao, prazo, status, origem)
  values (v_tenant, v_cli_imp, 'Fernando', 'Confirmar aprovação da proposta P-2026-001', current_date - 2, 'aberta', 'pipeline'),
         (v_tenant, v_cli_met, 'Fernando', 'Retomar cotação de solda', current_date + 3, 'aberta', 'pipeline');

  -- módulo MSFORT
  insert into colaboradores(empresa_consultora_id, nome, funcao_padrao)
  values (v_tenant, 'José Ferreira', 'soldador') returning id into v_colab1;

  insert into obras_servicos(empresa_consultora_id, cliente_id, contrato_id, tipo_servico, local, data_inicio, data_fim_prevista, status)
  values (v_tenant, v_cli_imp, v_ctr1, 'manutencao_cimbramento', 'Canteiro Zona Leste', current_date - 10, current_date + 5, 'em_execucao')
  returning id into v_obra1;

  insert into alocacao_equipe(empresa_consultora_id, obra_id, colaborador_id, funcao, data, horas_trabalhadas)
  values (v_tenant, v_obra1, v_colab1, 'soldador', current_date - 1, 8);

  insert into materiais_por_obra(empresa_consultora_id, obra_id, item, quantidade, custo_unitario, fornecedor)
  values (v_tenant, v_obra1, 'Eletrodo 3,25mm', 20, 35.00, 'Ferragens Silva');

  insert into manutencao_recorrente(empresa_consultora_id, cliente_id, equipamento_estrutura, periodicidade_dias, ultima_execucao, proxima_prevista)
  values (v_tenant, v_cli_imp, 'Cimbramento / formas', 30, current_date - 45, current_date - 15); -- vencida (dispara alerta)

  -- custo-hora do colaborador e orçamento da obra (para custo real x orçado)
  update colaboradores set custo_hora = 45 where id = v_colab1;
  update obras_servicos set custo_orcado = 5000 where id = v_obra1;
end $$;

-- =============================================================================
-- SEED ERP: cadastros + compra recebida (estoque + a pagar) + consumo
-- =============================================================================
do $$
declare
  v_tenant   uuid;
  v_dep      uuid;
  v_conta    uuid;
  v_cat_desp uuid;
  v_forn     uuid;
  v_prod_ele uuid;
  v_prod_cha uuid;
  v_pedido   uuid;
  v_obra     uuid;
begin
  select id into v_tenant from empresas_consultoras limit 1;

  insert into depositos(empresa_consultora_id, nome, local) values (v_tenant, 'Almoxarifado Central', 'Sede') returning id into v_dep;
  insert into contas_bancarias(empresa_consultora_id, nome, tipo, saldo_inicial) values (v_tenant, 'Caixa', 'caixa', 10000) returning id into v_conta;
  insert into categorias_financeiras(empresa_consultora_id, nome, natureza) values (v_tenant, 'Materiais', 'despesa') returning id into v_cat_desp;
  insert into fornecedores(empresa_consultora_id, nome, documento) values (v_tenant, 'Ferragens Silva', '11.111.111/0001-11') returning id into v_forn;

  insert into produtos(empresa_consultora_id, codigo, nome, unidade, estoque_minimo) values (v_tenant, 'ELE325', 'Eletrodo 3,25mm', 'kg', 10) returning id into v_prod_ele;
  insert into produtos(empresa_consultora_id, codigo, nome, unidade, estoque_minimo) values (v_tenant, 'CHA14', 'Chapa aço 1/4"', 'un', 5) returning id into v_prod_cha;

  -- pedido de compra
  insert into pedidos_compra(empresa_consultora_id, numero, fornecedor_id, deposito_id, categoria_id, data, vencimento, status)
  values (v_tenant, 'PC-001', v_forn, v_dep, v_cat_desp, current_date, current_date + 30, 'aberto') returning id into v_pedido;
  insert into itens_pedido_compra(empresa_consultora_id, pedido_id, produto_id, quantidade, custo_unitario)
  values (v_tenant, v_pedido, v_prod_ele, 50, 35.00),
         (v_tenant, v_pedido, v_prod_cha, 4, 320.00);

  -- receber o pedido: dispara entrada de estoque + título a pagar
  update pedidos_compra set status = 'recebido' where id = v_pedido;

  -- consumo de material na obra existente (dá baixa no estoque)
  select id into v_obra from obras_servicos where empresa_consultora_id = v_tenant order by data_inicio desc limit 1;
  if v_obra is not null then
    insert into consumo_producao(empresa_consultora_id, obra_id, produto_id, deposito_id, quantidade)
    values (v_tenant, v_obra, v_prod_ele, v_dep, 12);
  end if;
end $$;
