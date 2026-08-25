// =============================================================================
// Registro de entidades — dirige listas, formulários e navegação. (fluxo leve)
// Adicionar tela/módulo = adicionar entrada aqui.
// A lógica transacional (saldo, custo médio, baixa) fica em triggers no banco;
// campos calculados são marcados hideInForm.
// =============================================================================

export type FieldType =
  | "text" | "textarea" | "number" | "currency" | "percent"
  | "date" | "datetime" | "boolean" | "select" | "ref";

export type Option = { value: string; label: string; color?: string };

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Option[];
  ref?: { table: string; labelField: string };
  hideInForm?: boolean;    // campo calculado por trigger — só leitura na lista
  placeholder?: string;
};

export type GroupKey = "comercial" | "cadastros" | "estoque" | "compras" | "financeiro" | "producao" | "impacto" | "os" | "relatorios";

export type EntityDef = {
  key: string;
  label: string;
  labelPlural: string;
  icon: string;
  group: GroupKey;
  titleField: string;
  searchField?: string;
  orderBy?: { column: string; ascending?: boolean };
  fields: FieldDef[];
  listColumns: string[];
  hideInNav?: boolean;   // existe no registro (form/rotas) mas não aparece no menu
  docRoute?: string;     // se definido, a lista mostra um link "🖨️" -> `${docRoute}/${id}`
};

export type GroupDef = {
  key: GroupKey;
  label: string;
  icon: string;
  extras?: { href: string; label: string; icon: string }[];
};

import { FOTOS_PORTFOLIO } from "@/lib/empresa";
const FOTO_OPCOES: Option[] = [
  ...FOTOS_PORTFOLIO.map((f) => ({ value: f.arquivo, label: f.titulo })),
];

export const GROUPS: GroupDef[] = [
  { key: "comercial", label: "Comercial (CRM)", icon: "🤝", extras: [
    { href: "/propostas", label: "Propostas técnicas", icon: "📑" },
    { href: "/contratos", label: "Contratos", icon: "📜" },
    { href: "/precificador", label: "Precificador", icon: "🧮" },
  ] },
  { key: "cadastros", label: "Cadastros", icon: "🗂️" },
  { key: "estoque", label: "Estoque", icon: "📦", extras: [{ href: "/estoque/saldos", label: "Saldos", icon: "📊" }] },
  { key: "compras", label: "Compras", icon: "🛒" },
  { key: "financeiro", label: "Financeiro", icon: "💰", extras: [
    { href: "/financeiro/pagar", label: "Contas a Pagar", icon: "🔴" },
    { href: "/financeiro/receber", label: "Contas a Receber", icon: "🟢" },
    { href: "/financeiro/dre", label: "DRE mensal", icon: "📈" },
    { href: "/financeiro/fluxo", label: "Fluxo de caixa", icon: "💵" },
    { href: "/financeiro/relatorio", label: "Relatório financeiro", icon: "📊" },
  ] },
  { key: "impacto", label: "Impacto / Produção", icon: "🏭", extras: [
    { href: "/impacto/producao", label: "Lançamentos de produção", icon: "⚙️" },
    { href: "/impacto/relatorio", label: "Relatório de produção", icon: "📄" },
    { href: "/impacto/resumo", label: "Resumo de produção", icon: "📊" },
    { href: "/bonus", label: "Bônus (pagamento)", icon: "💸" },
    { href: "/impacto/demandas", label: "Painel de demandas", icon: "📌" },
  ] },
  { key: "os", label: "Ordens de Serviço", icon: "🧷", extras: [
    { href: "/os", label: "Ordens de Serviço", icon: "📋" },
    { href: "/obras", label: "Painel de obras (TV)", icon: "📺" },
  ] },
  { key: "relatorios", label: "Relatórios", icon: "📄", extras: [
    { href: "/gerencial", label: "Dashboard gerencial", icon: "📊" },
    { href: "/relatorios", label: "Central de relatórios", icon: "📄" },
    { href: "/relatorios/gerencial", label: "Relatório gerencial (PDF)", icon: "📈" },
  ] },
];

// ---- opções compartilhadas --------------------------------------------------
const STATUS_CLIENTE: Option[] = [
  { value: "ativo", label: "Ativo", color: "green" },
  { value: "inativo", label: "Inativo", color: "gray" },
  { value: "prospect", label: "Prospect", color: "blue" },
];
const NIVEL_REL: Option[] = [
  { value: "frio", label: "Frio", color: "gray" },
  { value: "morno", label: "Morno", color: "amber" },
  { value: "quente", label: "Quente", color: "orange" },
  { value: "estrategico", label: "Estratégico", color: "purple" },
];
const TIPO_INTERACAO: Option[] = [
  { value: "ligacao", label: "Ligação" }, { value: "visita", label: "Visita" },
  { value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "E-mail" },
  { value: "reuniao", label: "Reunião" },
];
const ETAPA_OPORT: Option[] = [
  { value: "prospeccao", label: "Prospecção", color: "gray" },
  { value: "proposta_enviada", label: "Proposta enviada", color: "blue" },
  { value: "negociacao", label: "Negociação", color: "amber" },
  { value: "fechado_ganho", label: "Ganho", color: "green" },
  { value: "fechado_perdido", label: "Perdido", color: "red" },
];
const STATUS_PROPOSTA: Option[] = [
  { value: "rascunho", label: "Rascunho", color: "gray" },
  { value: "enviada", label: "Enviada", color: "blue" },
  { value: "aprovada", label: "Aprovada", color: "green" },
  { value: "recusada", label: "Recusada", color: "red" },
];
const TIPO_CONTRATO: Option[] = [{ value: "pontual", label: "Pontual" }, { value: "recorrente", label: "Recorrente" }];
const STATUS_CONTRATO: Option[] = [
  { value: "ativo", label: "Ativo", color: "green" },
  { value: "encerrado", label: "Encerrado", color: "gray" },
  { value: "suspenso", label: "Suspenso", color: "amber" },
];
const STATUS_FATURA: Option[] = [
  { value: "previsto", label: "Previsto", color: "blue" },
  { value: "pago", label: "Pago", color: "green" },
  { value: "atrasado", label: "Atrasado", color: "red" },
];
const STATUS_TAREFA: Option[] = [
  { value: "aberta", label: "Aberta", color: "blue" },
  { value: "em_andamento", label: "Em andamento", color: "amber" },
  { value: "concluida", label: "Concluída", color: "green" },
  { value: "cancelada", label: "Cancelada", color: "gray" },
];
const ORIGEM_TAREFA: Option[] = [
  { value: "reuniao", label: "Reunião" }, { value: "pipeline", label: "Pipeline" },
  { value: "pos_venda", label: "Pós-venda" }, { value: "cobranca", label: "Cobrança" },
];
const TIPO_SERVICO: Option[] = [
  { value: "diarista", label: "Diarista" }, { value: "solda", label: "Solda" },
  { value: "montagem", label: "Montagem" }, { value: "manutencao_cimbramento", label: "Manut. cimbramento" },
  { value: "ajuste_campo", label: "Ajuste em campo" },
];
const STATUS_OBRA: Option[] = [
  { value: "planejada", label: "Planejada", color: "gray" },
  { value: "em_execucao", label: "Em execução", color: "blue" },
  { value: "concluida", label: "Concluída", color: "green" },
  { value: "parada", label: "Parada", color: "red" },
];
// ---- ERP --------------------------------------------------------------------
const TIPO_PRODUTO: Option[] = [
  { value: "insumo", label: "Insumo" }, { value: "produto", label: "Produto" }, { value: "servico", label: "Serviço" },
];
const NATUREZA: Option[] = [
  { value: "receita", label: "Receita", color: "green" }, { value: "despesa", label: "Despesa", color: "red" },
];
const GRUPO_DRE: Option[] = [
  { value: "receita", label: "Receita operacional", color: "green" },
  { value: "deducao", label: "Deduções / impostos s/ venda", color: "amber" },
  { value: "custo", label: "Custos diretos (CPV/CSP)", color: "orange" },
  { value: "despesa_operacional", label: "Despesas operacionais", color: "red" },
  { value: "despesa_financeira", label: "Despesas financeiras", color: "purple" },
  { value: "outras", label: "Outras / investimentos", color: "gray" },
];
const TIPO_CONTA: Option[] = [{ value: "banco", label: "Banco" }, { value: "caixa", label: "Caixa" }];
const TIPO_MOV_ESTOQUE: Option[] = [
  { value: "entrada", label: "Entrada", color: "green" },
  { value: "saida", label: "Saída", color: "red" },
  { value: "ajuste", label: "Ajuste", color: "amber" },
];
const ORIGEM_MOV: Option[] = [
  { value: "manual", label: "Manual" }, { value: "compra", label: "Compra" },
  { value: "producao", label: "Produção" }, { value: "ajuste", label: "Ajuste" },
  { value: "inventario", label: "Inventário" },
];
const TIPO_TITULO: Option[] = [
  { value: "pagar", label: "Despesa", color: "red" }, { value: "receber", label: "Receita", color: "green" },
];
const STATUS_TITULO: Option[] = [
  { value: "aberto", label: "Aberto", color: "blue" },
  { value: "pago", label: "Pago", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];
const STATUS_PEDIDO: Option[] = [
  { value: "aberto", label: "Aberto", color: "blue" },
  { value: "recebido", label: "Recebido", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];

const URGENCIA: Option[] = [
  { value: "baixa", label: "Baixa", color: "gray" },
  { value: "media", label: "Média", color: "amber" },
  { value: "alta", label: "Alta", color: "red" },
];
const STATUS_OS: Option[] = [
  { value: "a_fazer", label: "A fazer", color: "gray" },
  { value: "em_andamento", label: "Em andamento", color: "blue" },
  { value: "concluido", label: "Concluído", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];
const STATUS_ATIV: Option[] = [
  { value: "nao_iniciado", label: "Não iniciado", color: "gray" },
  { value: "em_andamento", label: "Em andamento", color: "blue" },
  { value: "concluido", label: "Concluído", color: "green" },
  { value: "parado", label: "Parado", color: "red" },
];

const refCliente: FieldDef = { key: "cliente_id", label: "Cliente", type: "ref", required: true, ref: { table: "clientes", labelField: "nome" } };
const refProduto: FieldDef = { key: "produto_id", label: "Produto", type: "ref", required: true, ref: { table: "produtos", labelField: "nome" } };
const refDeposito: FieldDef = { key: "deposito_id", label: "Depósito", type: "ref", required: true, ref: { table: "depositos", labelField: "nome" } };

export const ENTITIES: Record<string, EntityDef> = {
  // ============================ COMERCIAL (CRM) ==============================
  clientes: {
    key: "clientes", label: "Cliente", labelPlural: "Clientes", icon: "🏢", group: "comercial",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "cnpj", "telefone", "segmento", "nivel_relacionamento", "status"],
    fields: [
      { key: "nome", label: "Nome / Razão social", type: "text", required: true },
      { key: "cnpj", label: "CNPJ / CPF", type: "text" },
      { key: "telefone", label: "Telefone", type: "text" },
      { key: "email", label: "E-mail", type: "text" },
      { key: "endereco", label: "Endereço", type: "text" },
      { key: "segmento", label: "Segmento", type: "text" },
      { key: "origem", label: "Origem", type: "text" },
      { key: "status", label: "Status", type: "select", options: STATUS_CLIENTE },
      { key: "responsavel_comercial", label: "Responsável comercial", type: "text" },
      { key: "nivel_relacionamento", label: "Nível de relacionamento", type: "select", options: NIVEL_REL },
    ],
  },
  contatos: {
    key: "contatos", label: "Contato", labelPlural: "Contatos", icon: "👤", group: "comercial",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "cliente_id", "cargo", "telefone", "email", "e_decisor"],
    fields: [
      refCliente,
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "cargo", label: "Cargo", type: "text" },
      { key: "telefone", label: "Telefone", type: "text" },
      { key: "email", label: "E-mail", type: "text" },
      { key: "e_decisor", label: "É decisor?", type: "boolean" },
    ],
  },
  interacoes: {
    key: "interacoes", label: "Interação", labelPlural: "Interações", icon: "💬", group: "comercial",
    titleField: "resumo", orderBy: { column: "data", ascending: false },
    listColumns: ["data", "cliente_id", "tipo", "resumo", "proximo_passo", "responsavel"],
    fields: [
      refCliente,
      { key: "contato_id", label: "Contato", type: "ref", ref: { table: "contatos", labelField: "nome" } },
      { key: "data", label: "Data", type: "datetime", required: true },
      { key: "tipo", label: "Tipo", type: "select", options: TIPO_INTERACAO, required: true },
      { key: "resumo", label: "Resumo", type: "textarea" },
      { key: "proximo_passo", label: "Próximo passo", type: "textarea" },
      { key: "responsavel", label: "Responsável", type: "text" },
    ],
  },
  oportunidades: {
    key: "oportunidades", label: "Oportunidade", labelPlural: "Oportunidades", icon: "🎯", group: "comercial",
    titleField: "titulo", searchField: "titulo", orderBy: { column: "data_prevista_fechamento", ascending: true },
    listColumns: ["titulo", "cliente_id", "valor_estimado", "etapa", "probabilidade", "data_prevista_fechamento"],
    fields: [
      refCliente,
      { key: "titulo", label: "Título", type: "text", required: true },
      { key: "valor_estimado", label: "Valor estimado", type: "currency" },
      { key: "etapa", label: "Etapa", type: "select", options: ETAPA_OPORT, required: true },
      { key: "probabilidade", label: "Probabilidade (%)", type: "percent" },
      { key: "data_prevista_fechamento", label: "Previsão de fechamento", type: "date" },
      { key: "origem", label: "Origem", type: "text" },
      { key: "motivo_perda", label: "Motivo da perda", type: "textarea" },
    ],
  },
  propostas: {
    key: "propostas", label: "Proposta", labelPlural: "Propostas técnicas", icon: "📑", group: "comercial",
    hideInNav: true,
    titleField: "numero", searchField: "numero", orderBy: { column: "data", ascending: false },
    listColumns: ["numero", "cliente_id", "objeto", "valor_total", "validade", "status"],
    fields: [
      { key: "cliente_id", label: "Cliente", type: "ref", required: true, ref: { table: "clientes", labelField: "nome" } },
      { key: "numero", label: "Número", type: "text" },
      { key: "data", label: "Emissão", type: "date" },
      { key: "validade", label: "Válido até", type: "date" },
      { key: "status", label: "Status", type: "select", options: STATUS_PROPOSTA },
      { key: "objeto", label: "Objeto (resumo)", type: "text" },
      { key: "apresentacao", label: "Apresentação", type: "textarea" },
      { key: "premissas", label: "Premissas e critérios técnicos", type: "textarea" },
      { key: "escopo_desc", label: "Escopo (descritivo)", type: "textarea" },
      { key: "prazo_entrega", label: "Prazo de entrega", type: "text" },
      { key: "pagamento", label: "Pagamento", type: "text" },
      { key: "entrega_frete", label: "Entrega / frete", type: "text" },
      { key: "impostos", label: "Impostos", type: "text" },
      { key: "valor_total", label: "Valor total", type: "currency", hideInForm: true },
    ],
  },
  itens_proposta: {
    key: "itens_proposta", label: "Item da proposta", labelPlural: "Itens da proposta", icon: "➕", group: "comercial",
    hideInNav: true,
    titleField: "descricao", orderBy: { column: "ordem", ascending: true },
    listColumns: ["descricao", "quantidade", "valor_unit", "valor_total"],
    fields: [
      { key: "proposta_id", label: "Proposta", type: "ref", required: true, ref: { table: "propostas", labelField: "numero" } },
      { key: "descricao", label: "Descrição", type: "textarea", required: true },
      { key: "referencia", label: "Referência", type: "text" },
      { key: "quantidade", label: "Quantidade", type: "number" },
      { key: "valor_unit", label: "Valor unitário", type: "currency" },
      { key: "foto", label: "Foto", type: "select", options: FOTO_OPCOES },
      { key: "ordem", label: "Ordem", type: "number" },
      { key: "valor_total", label: "Valor total", type: "currency", hideInForm: true },
    ],
  },
  contratos: {
    key: "contratos", label: "Contrato", labelPlural: "Contratos", icon: "📜", group: "comercial",
    hideInNav: true,
    titleField: "numero", searchField: "numero", orderBy: { column: "data_inicio", ascending: false },
    listColumns: ["numero", "cliente_id", "tipo", "valor", "data_inicio", "data_fim", "status"],
    fields: [
      refCliente,
      { key: "proposta_id", label: "Proposta de origem", type: "ref", ref: { table: "propostas", labelField: "numero" } },
      { key: "numero", label: "Número", type: "text" },
      { key: "data_inicio", label: "Início", type: "date" },
      { key: "data_fim", label: "Fim", type: "date" },
      { key: "tipo", label: "Tipo", type: "select", options: TIPO_CONTRATO },
      { key: "valor", label: "Valor", type: "currency" },
      { key: "status", label: "Status", type: "select", options: STATUS_CONTRATO },
      { key: "objeto", label: "Objeto", type: "textarea" },
      { key: "escopo_desc", label: "Escopo dos serviços", type: "textarea" },
      { key: "condicoes", label: "Condições de pagamento", type: "textarea" },
      { key: "clausulas", label: "Cláusulas", type: "textarea" },
    ],
  },
  faturamento: {
    key: "faturamento", label: "Faturamento", labelPlural: "Faturamento", icon: "💵", group: "comercial",
    titleField: "competencia", orderBy: { column: "competencia", ascending: false },
    listColumns: ["competencia", "cliente_id", "contrato_id", "valor_previsto", "valor_realizado", "status"],
    fields: [
      { key: "contrato_id", label: "Contrato", type: "ref", required: true, ref: { table: "contratos", labelField: "numero" } },
      refCliente,
      { key: "competencia", label: "Competência", type: "date", required: true },
      { key: "valor_previsto", label: "Valor previsto", type: "currency" },
      { key: "valor_realizado", label: "Valor realizado", type: "currency" },
      { key: "data_pagamento", label: "Data de pagamento", type: "date" },
      { key: "status", label: "Status", type: "select", options: STATUS_FATURA },
    ],
  },
  tarefas_followup: {
    key: "tarefas_followup", label: "Tarefa", labelPlural: "Tarefas / Follow-up", icon: "✅", group: "comercial",
    titleField: "descricao", orderBy: { column: "prazo", ascending: true },
    listColumns: ["descricao", "cliente_id", "responsavel", "prazo", "origem", "status"],
    fields: [
      refCliente,
      { key: "descricao", label: "Descrição", type: "textarea", required: true },
      { key: "responsavel", label: "Responsável", type: "text" },
      { key: "prazo", label: "Prazo", type: "date" },
      { key: "status", label: "Status", type: "select", options: STATUS_TAREFA },
      { key: "origem", label: "Origem", type: "select", options: ORIGEM_TAREFA },
    ],
  },
  documentos: {
    key: "documentos", label: "Documento", labelPlural: "Documentos", icon: "📎", group: "comercial",
    titleField: "tipo", orderBy: { column: "data", ascending: false },
    listColumns: ["tipo", "cliente_id", "referencia", "data"],
    fields: [
      refCliente,
      { key: "tipo", label: "Tipo", type: "text" },
      { key: "referencia", label: "Link / referência", type: "text" },
      { key: "data", label: "Data", type: "date" },
    ],
  },

  // ============================== CADASTROS ==================================
  fornecedores: {
    key: "fornecedores", label: "Fornecedor", labelPlural: "Fornecedores", icon: "🚚", group: "cadastros",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "documento", "telefone", "email", "ativo"],
    fields: [
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "documento", label: "CNPJ/CPF", type: "text" },
      { key: "telefone", label: "Telefone", type: "text" },
      { key: "email", label: "E-mail", type: "text" },
      { key: "contato", label: "Contato", type: "text" },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },
  composicao_custo: {
    key: "composicao_custo", label: "Item de custo", labelPlural: "Composição de custo", icon: "🧩", group: "cadastros",
    hideInNav: true,
    titleField: "descricao", orderBy: { column: "categoria", ascending: true },
    listColumns: ["categoria", "descricao", "quantidade", "custo_unitario", "custo_total"],
    fields: [
      { key: "produto_id", label: "Produto", type: "ref", required: true, ref: { table: "produtos", labelField: "nome" } },
      { key: "categoria", label: "Categoria", type: "select", required: true, options: [
        { value: "material", label: "Material" }, { value: "mao_de_obra", label: "Mão de obra" },
        { value: "equipamento", label: "Equipamento" }, { value: "terceiro", label: "Terceiros" },
        { value: "frete", label: "Frete/transporte" }, { value: "outros", label: "Outros" },
      ] },
      { key: "descricao", label: "Descrição", type: "text", required: true },
      { key: "quantidade", label: "Quantidade", type: "number" },
      { key: "custo_unitario", label: "Custo unitário", type: "currency" },
      { key: "custo_total", label: "Custo total", type: "currency", hideInForm: true },
    ],
  },
  produtos: {
    key: "produtos", label: "Produto/Insumo", labelPlural: "Produtos / Insumos", icon: "🧱", group: "cadastros",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["codigo", "nome", "secao", "tipo", "unidade", "custo_medio", "estoque_minimo", "ativo"],
    fields: [
      { key: "codigo", label: "Código", type: "text" },
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "secao", label: "Seção (almoxarifado)", type: "select", options: [
        { value: "epis", label: "EPIs" }, { value: "eletricos", label: "Elétricos" },
        { value: "metalicos", label: "Metálicos" }, { value: "ferramentas", label: "Ferramentas" },
        { value: "consumiveis", label: "Consumíveis" }, { value: "hidraulico", label: "Hidráulico" },
        { value: "outros", label: "Outros" },
      ] },
      { key: "tipo", label: "Tipo", type: "select", options: TIPO_PRODUTO },
      { key: "unidade", label: "Unidade", type: "text", placeholder: "un, kg, m…" },
      { key: "custo_medio", label: "Custo médio", type: "currency", hideInForm: true },
      { key: "estoque_minimo", label: "Estoque mínimo", type: "number" },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },
  depositos: {
    key: "depositos", label: "Depósito", labelPlural: "Depósitos", icon: "🏬", group: "cadastros",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "local", "ativo"],
    fields: [
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "local", label: "Local", type: "text" },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },
  categorias_financeiras: {
    key: "categorias_financeiras", label: "Categoria", labelPlural: "Categorias financeiras", icon: "🏷️", group: "cadastros",
    titleField: "nome", searchField: "nome", orderBy: { column: "ordem", ascending: true },
    listColumns: ["ordem", "nome", "natureza", "grupo_dre", "ativo"],
    fields: [
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "natureza", label: "Natureza", type: "select", options: NATUREZA, required: true },
      { key: "grupo_dre", label: "Grupo no DRE", type: "select", options: GRUPO_DRE },
      { key: "ordem", label: "Ordem (no relatório)", type: "number" },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },
  subcategorias_financeiras: {
    key: "subcategorias_financeiras", label: "Subcategoria", labelPlural: "Subcategorias", icon: "🔖", group: "cadastros",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "categoria_id", "ativo"],
    fields: [
      { key: "categoria_id", label: "Categoria", type: "ref", required: true, ref: { table: "categorias_financeiras", labelField: "nome" } },
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },

  contas_bancarias: {
    key: "contas_bancarias", label: "Conta", labelPlural: "Contas / Caixa", icon: "🏦", group: "cadastros",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "tipo", "saldo_inicial", "saldo_atual", "ativo"],
    fields: [
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "tipo", label: "Tipo", type: "select", options: TIPO_CONTA },
      { key: "saldo_inicial", label: "Saldo inicial", type: "currency" },
      { key: "saldo_atual", label: "Saldo atual", type: "currency", hideInForm: true },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },
  colaboradores: {
    key: "colaboradores", label: "Colaborador", labelPlural: "Colaboradores", icon: "👷", group: "cadastros",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "funcao_padrao", "custo_hora", "ativo"],
    fields: [
      { key: "nome", label: "Nome", type: "text", required: true },
      { key: "funcao_padrao", label: "Função padrão", type: "text" },
      { key: "custo_hora", label: "Custo/hora", type: "currency" },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },

  // =============================== ESTOQUE ==================================
  movimentacoes_estoque: {
    key: "movimentacoes_estoque", label: "Movimentação", labelPlural: "Movimentações de estoque", icon: "🔁", group: "estoque",
    titleField: "produto_id", orderBy: { column: "data", ascending: false },
    listColumns: ["data", "produto_id", "deposito_id", "tipo", "quantidade", "custo_unitario", "origem"],
    fields: [
      refProduto,
      refDeposito,
      { key: "tipo", label: "Tipo", type: "select", options: TIPO_MOV_ESTOQUE, required: true },
      { key: "quantidade", label: "Quantidade", type: "number", required: true },
      { key: "custo_unitario", label: "Custo unitário (na entrada)", type: "currency", placeholder: "obrigatório na entrada" },
      { key: "origem", label: "Origem", type: "select", options: ORIGEM_MOV },
      { key: "data", label: "Data", type: "datetime" },
      { key: "observacao", label: "Observação", type: "textarea" },
    ],
  },

  // =============================== COMPRAS ==================================
  pedidos_compra: {
    key: "pedidos_compra", label: "Pedido de compra", labelPlural: "Pedidos de compra", icon: "🧾", group: "compras",
    docRoute: "/compras/pedido",
    titleField: "numero", searchField: "numero", orderBy: { column: "data", ascending: false },
    listColumns: ["numero", "fornecedor_id", "deposito_id", "data", "valor_total", "status"],
    fields: [
      { key: "numero", label: "Número", type: "text" },
      { key: "fornecedor_id", label: "Fornecedor", type: "ref", required: true, ref: { table: "fornecedores", labelField: "nome" } },
      { key: "deposito_id", label: "Depósito de destino", type: "ref", ref: { table: "depositos", labelField: "nome" } },
      { key: "categoria_id", label: "Categoria (a pagar)", type: "ref", ref: { table: "categorias_financeiras", labelField: "nome" } },
      { key: "data", label: "Data", type: "date" },
      { key: "vencimento", label: "Vencimento (a pagar)", type: "date" },
      { key: "valor_total", label: "Valor total", type: "currency", hideInForm: true },
      { key: "status", label: "Status (mude p/ 'recebido' para dar entrada)", type: "select", options: STATUS_PEDIDO },
      { key: "observacao", label: "Observação", type: "textarea" },
    ],
  },
  itens_pedido_compra: {
    key: "itens_pedido_compra", label: "Item de pedido", labelPlural: "Itens de pedido", icon: "➕", group: "compras",
    titleField: "produto_id", orderBy: { column: "id", ascending: false },
    listColumns: ["pedido_id", "produto_id", "quantidade", "custo_unitario", "subtotal"],
    fields: [
      { key: "pedido_id", label: "Pedido", type: "ref", required: true, ref: { table: "pedidos_compra", labelField: "numero" } },
      refProduto,
      { key: "quantidade", label: "Quantidade", type: "number", required: true },
      { key: "custo_unitario", label: "Custo unitário", type: "currency", required: true },
      { key: "subtotal", label: "Subtotal", type: "currency", hideInForm: true },
    ],
  },

  // ============================== FINANCEIRO ================================
  titulos_financeiros: {
    key: "titulos_financeiros", label: "Título", labelPlural: "Contas a pagar/receber", icon: "💳", group: "financeiro",
    hideInNav: true,
    titleField: "descricao", searchField: "descricao", orderBy: { column: "vencimento", ascending: true },
    listColumns: ["descricao", "tipo", "valor", "vencimento", "status", "data_pagamento"],
    fields: [
      { key: "tipo", label: "Tipo (Despesa/Receita)", type: "select", options: TIPO_TITULO, required: true },
      { key: "descricao", label: "Descrição", type: "text", required: true },
      { key: "cliente_id", label: "Cliente (receita)", type: "ref", ref: { table: "clientes", labelField: "nome" } },
      { key: "fornecedor_id", label: "Fornecedor (despesa)", type: "ref", ref: { table: "fornecedores", labelField: "nome" } },
      { key: "categoria_id", label: "Categoria", type: "ref", ref: { table: "categorias_financeiras", labelField: "nome" } },
      { key: "valor", label: "Valor", type: "currency", required: true },
      { key: "vencimento", label: "Vencimento", type: "date" },
      { key: "status", label: "Status", type: "select", options: STATUS_TITULO },
      { key: "conta_bancaria_id", label: "Conta da baixa", type: "ref", ref: { table: "contas_bancarias", labelField: "nome" } },
      { key: "data_pagamento", label: "Data de pagamento", type: "date" },
    ],
  },

  // ============================ PRODUÇÃO / OS ==============================
  obras_servicos: {
    key: "obras_servicos", label: "Obra / OS", labelPlural: "Obras / Ordens de serviço", icon: "🏗️", group: "producao",
    titleField: "local", searchField: "local", orderBy: { column: "data_inicio", ascending: false },
    listColumns: ["local", "cliente_id", "tipo_servico", "custo_orcado", "data_inicio", "data_fim_prevista", "status"],
    fields: [
      refCliente,
      { key: "contrato_id", label: "Contrato", type: "ref", ref: { table: "contratos", labelField: "numero" } },
      { key: "tipo_servico", label: "Tipo de serviço", type: "select", options: TIPO_SERVICO },
      { key: "local", label: "Local", type: "text" },
      { key: "custo_orcado", label: "Custo orçado", type: "currency" },
      { key: "data_inicio", label: "Início", type: "date" },
      { key: "data_fim_prevista", label: "Fim previsto", type: "date" },
      { key: "data_fim_real", label: "Fim real", type: "date" },
      { key: "status", label: "Status", type: "select", options: STATUS_OBRA },
    ],
  },
  alocacao_equipe: {
    key: "alocacao_equipe", label: "Alocação", labelPlural: "Alocação de Equipe", icon: "🧰", group: "producao",
    titleField: "funcao", orderBy: { column: "data", ascending: false },
    listColumns: ["data", "obra_id", "colaborador_id", "funcao", "horas_trabalhadas"],
    fields: [
      { key: "obra_id", label: "Obra", type: "ref", required: true, ref: { table: "obras_servicos", labelField: "local" } },
      { key: "colaborador_id", label: "Colaborador", type: "ref", required: true, ref: { table: "colaboradores", labelField: "nome" } },
      { key: "funcao", label: "Função", type: "text" },
      { key: "data", label: "Data", type: "date", required: true },
      { key: "horas_trabalhadas", label: "Horas trabalhadas", type: "number" },
    ],
  },
  materiais_por_obra: {
    key: "materiais_por_obra", label: "Material previsto", labelPlural: "Materiais (previsto)", icon: "📋", group: "producao",
    titleField: "item", searchField: "item", orderBy: { column: "item", ascending: true },
    listColumns: ["item", "obra_id", "quantidade", "custo_unitario", "fornecedor"],
    fields: [
      { key: "obra_id", label: "Obra", type: "ref", required: true, ref: { table: "obras_servicos", labelField: "local" } },
      { key: "item", label: "Item", type: "text", required: true },
      { key: "quantidade", label: "Quantidade", type: "number" },
      { key: "custo_unitario", label: "Custo unitário", type: "currency" },
      { key: "fornecedor", label: "Fornecedor", type: "text" },
    ],
  },
  consumo_producao: {
    key: "consumo_producao", label: "Consumo", labelPlural: "Consumo de material", icon: "🔥", group: "producao",
    titleField: "produto_id", orderBy: { column: "data", ascending: false },
    listColumns: ["data", "obra_id", "produto_id", "deposito_id", "quantidade"],
    fields: [
      { key: "obra_id", label: "Obra", type: "ref", required: true, ref: { table: "obras_servicos", labelField: "local" } },
      refProduto,
      refDeposito,
      { key: "quantidade", label: "Quantidade", type: "number", required: true },
      { key: "data", label: "Data", type: "date" },
      { key: "observacao", label: "Observação", type: "textarea" },
    ],
  },

  demandas: {
    key: "demandas", label: "Demanda", labelPlural: "Demandas", icon: "📌", group: "impacto",
    hideInNav: true,
    titleField: "titulo", searchField: "titulo", orderBy: { column: "data_solicitacao", ascending: false },
    listColumns: ["titulo", "cliente_id", "solicitante", "responsavel", "data_entrega_prevista", "status"],
    fields: [
      { key: "cliente_id", label: "Cliente", type: "ref", ref: { table: "clientes", labelField: "nome" } },
      { key: "titulo", label: "O que foi solicitado", type: "text", required: true },
      { key: "descricao", label: "Detalhes", type: "textarea" },
      { key: "solicitante", label: "Quem solicitou", type: "text" },
      { key: "responsavel", label: "Responsável (interno)", type: "text" },
      { key: "data_solicitacao", label: "Data da solicitação", type: "date" },
      { key: "data_entrega_prevista", label: "Entrega prevista", type: "date" },
      { key: "data_entrega_real", label: "Entrega real", type: "date" },
      { key: "valor_cobrado", label: "Valor cobrado", type: "currency" },
      { key: "prioridade", label: "Prioridade", type: "select", options: [
        { value: "baixa", label: "Baixa", color: "gray" }, { value: "media", label: "Média", color: "amber" }, { value: "alta", label: "Alta", color: "red" },
      ] },
      { key: "status", label: "Status", type: "select", options: [
        { value: "aberta", label: "Aberta", color: "gray" }, { value: "em_andamento", label: "Em andamento", color: "blue" },
        { value: "bloqueada", label: "Bloqueada", color: "red" }, { value: "concluida", label: "Concluída", color: "green" },
        { value: "cancelada", label: "Cancelada", color: "gray" },
      ] },
      { key: "bloqueio", label: "Motivo do bloqueio (por que não anda)", type: "textarea" },
    ],
  },

  // ============================ IMPACTO / PRODUÇÃO =========================
  bonus_regras: {
    key: "bonus_regras", label: "Regra de bônus", labelPlural: "Regras de bônus", icon: "📐", group: "cadastros",
    titleField: "tipo", orderBy: { column: "tipo", ascending: true },
    listColumns: ["tipo", "minimo", "bonus_fixo", "bonus_por_50", "ativo"],
    fields: [
      { key: "tipo", label: "Tipo (LD/LP/LPP)", type: "text", required: true },
      { key: "minimo", label: "Mínimo por dia", type: "number" },
      { key: "bonus_fixo", label: "Bônus fixo", type: "currency" },
      { key: "bonus_por_50", label: "Bônus por 50 (acima do mínimo)", type: "currency" },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },
  bonus_producao: {
    key: "bonus_producao", label: "Produção de bônus", labelPlural: "Produção de bônus (diária)", icon: "🗓️", group: "impacto",
    hideInNav: true,
    titleField: "data", orderBy: { column: "data", ascending: false },
    listColumns: ["data", "colaborador_id", "ld", "lp", "lpp", "na"],
    fields: [
      { key: "data", label: "Data", type: "date", required: true },
      { key: "colaborador_id", label: "Funcionário", type: "ref", required: true, ref: { table: "colaboradores", labelField: "nome" } },
      { key: "ld", label: "LD (peças)", type: "number" },
      { key: "lp", label: "LP (peças)", type: "number" },
      { key: "lpp", label: "LPP (peças)", type: "number" },
      { key: "na", label: "NA (peças)", type: "number" },
    ],
  },
  pecas: {
    key: "pecas", label: "Peça", labelPlural: "Peças", icon: "🔩", group: "impacto",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "tipo", "peso", "valor_kg", "ativo"],
    fields: [
      { key: "nome", label: "Nome da peça", type: "text", required: true },
      { key: "tipo", label: "Tipo (LD/LP/LPP)", type: "text" },
      { key: "peso", label: "Peso unitário (kg)", type: "number" },
      { key: "valor_kg", label: "Valor por kg (R$)", type: "currency" },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },
  servicos: {
    key: "servicos", label: "Serviço", labelPlural: "Serviços (preços)", icon: "🛠️", group: "impacto",
    titleField: "nome", searchField: "nome", orderBy: { column: "nome", ascending: true },
    listColumns: ["nome", "unidade", "valor", "conta_bonus", "ativo"],
    fields: [
      { key: "nome", label: "Nome do serviço", type: "text", required: true },
      { key: "unidade", label: "Unidade", type: "select", options: [{ value: "KG", label: "Por kg" }, { value: "UND", label: "Por unidade" }] },
      { key: "valor", label: "Preço (R$ por kg ou unid.)", type: "currency" },
      { key: "conta_bonus", label: "Conta para bônus?", type: "boolean" },
      { key: "ativo", label: "Ativo", type: "boolean" },
    ],
  },
  producao: {
    key: "producao", label: "Produção", labelPlural: "Lançamentos de produção", icon: "⚙️", group: "impacto",
    hideInNav: true,
    titleField: "peca_nome", searchField: "peca_nome", orderBy: { column: "data", ascending: false },
    listColumns: ["data", "cliente_id", "peca_nome", "servico_id", "quantidade", "peso_total", "valor_total"],
    fields: [
      { key: "data", label: "Data", type: "date", required: true },
      { key: "cliente_id", label: "Cliente", type: "ref", ref: { table: "clientes", labelField: "nome" } },
      { key: "colaborador_id", label: "Colaborador", type: "ref", ref: { table: "colaboradores", labelField: "nome" } },
      { key: "peca_id", label: "Peça (cadastro)", type: "ref", ref: { table: "pecas", labelField: "nome" } },
      { key: "peca_nome", label: "Peça (nome)", type: "text" },
      { key: "servico_id", label: "Serviço", type: "ref", ref: { table: "servicos", labelField: "nome" } },
      { key: "tipo", label: "Tipo", type: "text" },
      { key: "quantidade", label: "Quantidade", type: "number" },
      { key: "peso_unit", label: "Peso unitário (kg)", type: "number" },
      { key: "valor_unit", label: "Preço do serviço (R$)", type: "currency" },
      { key: "peso_total", label: "Peso total (kg)", type: "number", hideInForm: true },
      { key: "valor_total", label: "Valor total", type: "currency", hideInForm: true },
    ],
  },

  // ============================ ORDENS DE SERVIÇO =========================
  ordens_servico: {
    key: "ordens_servico", label: "Ordem de Serviço", labelPlural: "Ordens de Serviço", icon: "📋", group: "os",
    hideInNav: true,
    titleField: "titulo", searchField: "titulo", orderBy: { column: "prazo", ascending: true },
    listColumns: ["numero", "titulo", "cliente_id", "responsavel", "prazo", "urgencia", "status"],
    fields: [
      { key: "numero", label: "Número (automático se vazio)", type: "text" },
      { key: "cliente_id", label: "Cliente", type: "ref", ref: { table: "clientes", labelField: "nome" } },
      { key: "contrato_id", label: "Contrato de origem", type: "ref", ref: { table: "contratos", labelField: "numero" } },
      { key: "proposta_id", label: "Proposta de origem", type: "ref", ref: { table: "propostas", labelField: "numero" } },
      { key: "titulo", label: "O quê (título)", type: "text", required: true },
      { key: "motivo", label: "Por quê", type: "textarea" },
      { key: "local", label: "Onde", type: "text" },
      { key: "como_sera_feito", label: "Como será feito", type: "textarea" },
      { key: "responsavel", label: "Responsável", type: "text" },
      { key: "prazo", label: "Prazo", type: "date" },
      { key: "data_realizado", label: "Realizado em", type: "date" },
      { key: "custo_estimado", label: "Custo estimado", type: "currency" },
      { key: "urgencia", label: "Urgência", type: "select", options: URGENCIA },
      { key: "status", label: "Status", type: "select", options: STATUS_OS },
      { key: "is_obra", label: "É obra? (aparece no painel de obras)", type: "boolean" },
      { key: "gargalos", label: "Gargalos / atenção", type: "textarea" },
      { key: "orientacoes", label: "Principais cuidados / orientações", type: "textarea" },
    ],
  },
  atividades_os: {
    key: "atividades_os", label: "Atividade", labelPlural: "Atividades", icon: "☑️", group: "os",
    hideInNav: true,
    titleField: "descricao", orderBy: { column: "data_inicio", ascending: true },
    listColumns: ["descricao", "colaborador_id", "data_inicio", "data_fim", "conclusao_pct", "status"],
    fields: [
      { key: "os_id", label: "OS", type: "ref", required: true, ref: { table: "ordens_servico", labelField: "titulo" } },
      { key: "descricao", label: "Descrição", type: "textarea", required: true },
      { key: "colaborador_id", label: "Responsável", type: "ref", ref: { table: "colaboradores", labelField: "nome" } },
      { key: "setor", label: "Setor", type: "text" },
      { key: "data_inicio", label: "Início", type: "date" },
      { key: "data_fim", label: "Fim", type: "date" },
      { key: "status", label: "Status", type: "select", options: STATUS_ATIV },
      { key: "conclusao_pct", label: "Conclusão (%)", type: "number" },
      { key: "alocacao_pct", label: "Alocação (%)", type: "number" },
    ],
  },
  insumos_os: {
    key: "insumos_os", label: "Insumo", labelPlural: "Insumos", icon: "📦", group: "os",
    hideInNav: true,
    titleField: "descricao", orderBy: { column: "descricao", ascending: true },
    listColumns: ["descricao", "produto_id", "quantidade", "custo_unitario", "custo_total"],
    fields: [
      { key: "os_id", label: "OS", type: "ref", required: true, ref: { table: "ordens_servico", labelField: "titulo" } },
      { key: "produto_id", label: "Produto (estoque)", type: "ref", ref: { table: "produtos", labelField: "nome" } },
      { key: "descricao", label: "Descrição", type: "text", required: true },
      { key: "quantidade", label: "Quantidade", type: "number" },
      { key: "custo_unitario", label: "Custo unitário", type: "currency" },
      { key: "custo_total", label: "Custo total", type: "currency", hideInForm: true },
    ],
  },

  manutencao_recorrente: {
    key: "manutencao_recorrente", label: "Manutenção", labelPlural: "Manutenção Recorrente", icon: "🔧", group: "producao",
    titleField: "equipamento_estrutura", searchField: "equipamento_estrutura", orderBy: { column: "proxima_prevista", ascending: true },
    listColumns: ["equipamento_estrutura", "cliente_id", "periodicidade_dias", "ultima_execucao", "proxima_prevista"],
    fields: [
      refCliente,
      { key: "equipamento_estrutura", label: "Equipamento / estrutura", type: "text", required: true },
      { key: "periodicidade_dias", label: "Periodicidade (dias)", type: "number", required: true },
      { key: "ultima_execucao", label: "Última execução", type: "date" },
      { key: "proxima_prevista", label: "Próxima prevista", type: "date" },
    ],
  },
};

export const ENTITY_LIST = Object.values(ENTITIES);

export function getEntity(key: string): EntityDef | undefined {
  return ENTITIES[key];
}

export function entitiesByGroup(group: GroupKey): EntityDef[] {
  return ENTITY_LIST.filter((e) => e.group === group && !e.hideInNav);
}
