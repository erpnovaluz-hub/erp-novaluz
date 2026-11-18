// =============================================================================
// Lista FECHADA de ferramentas do agente (Fase 1: leitura + verdes de tarefa).
// Cada entrada vira uma "tool" para o Claude; META guarda a faixa e se a ação
// é reversível pelo botão Desfazer. O modelo nunca escreve SQL — só chama estas.
// =============================================================================
import type { Faixa } from "./tipos";

const VINCULOS = ["os", "obra", "cliente", "oportunidade", "proposta", "titulo", "requisicao", "pedido"];
const PRIORIDADES = ["baixa", "media", "alta", "urgente"];

export type DefFerramenta = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, any>; required?: string[] };
};

export const META: Record<string, { faixa: Faixa; reversivel: boolean }> = {
  // leitura
  buscar_tarefas: { faixa: "leitura", reversivel: false },
  buscar_os: { faixa: "leitura", reversivel: false },
  listar_projetos: { faixa: "leitura", reversivel: false },
  listar_pessoas: { faixa: "leitura", reversivel: false },
  listar_modelos: { faixa: "leitura", reversivel: false },
  // verdes
  criar_tarefa: { faixa: "verde", reversivel: true },
  atualizar_tarefa: { faixa: "verde", reversivel: false },
  vincular_tarefa: { faixa: "verde", reversivel: true },
  concluir_tarefa: { faixa: "verde", reversivel: true },
  comentar_tarefa: { faixa: "verde", reversivel: true },
  notificar_usuario: { faixa: "verde", reversivel: false },
  criar_projeto_de_modelo: { faixa: "verde", reversivel: false },
  // amarelas (OS) — propostas, só executam após o clique de confirmação
  criar_os: { faixa: "amarela", reversivel: true },
  atribuir_responsavel: { faixa: "amarela", reversivel: true },
  alterar_prazo_os: { faixa: "amarela", reversivel: true },
  mudar_status_os: { faixa: "amarela", reversivel: true },
  lancar_apontamento: { faixa: "amarela", reversivel: true },
  lancar_insumo_os: { faixa: "amarela", reversivel: true },
  concluir_os: { faixa: "amarela", reversivel: true },
  // financeiro — leitura (F0)
  posicao_caixa: { faixa: "leitura", reversivel: false },
  buscar_titulos: { faixa: "leitura", reversivel: false },
  indicadores_financeiros: { faixa: "leitura", reversivel: false },
  dre_resumo: { faixa: "leitura", reversivel: false },
  conferir_financeiro: { faixa: "leitura", reversivel: false },
  // financeiro — controle de caixa (F1). Verdes executam; amarelas viram cartão.
  criar_cobranca: { faixa: "verde", reversivel: true },
  salvar_cenario_caixa: { faixa: "verde", reversivel: true },
  criar_titulo: { faixa: "amarela", reversivel: true },
  alterar_vencimento_titulo: { faixa: "amarela", reversivel: true },
};

export const FERRAMENTAS: DefFerramenta[] = [
  {
    name: "buscar_tarefas",
    description: "Busca tarefas que o usuário pode ver. Use SEMPRE antes de criar, para não duplicar.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "trecho do título (opcional)" },
        apenas_abertas: { type: "boolean", description: "só não concluídas (padrão true)" },
        responsavel_id: { type: "string" },
        vinculo_tipo: { type: "string", enum: VINCULOS },
        vinculo_id: { type: "string" },
      },
    },
  },
  {
    name: "buscar_os",
    description: "Busca ordens de serviço que o usuário pode ver (número, título, status, responsável).",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "trecho do título/número" },
        status: { type: "string", enum: ["orcamento", "a_fazer", "em_andamento", "pausada", "concluido", "faturada", "cancelado"] },
      },
    },
  },
  {
    name: "listar_projetos",
    description: "Lista os projetos de tarefas visíveis ao usuário.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "listar_pessoas",
    description: "Lista as pessoas da empresa (id e nome) para atribuir responsável ou notificar.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "listar_modelos",
    description: "Lista os modelos de projeto/checklist disponíveis.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "criar_tarefa",
    description: "Cria uma tarefa. Não invente responsável, prazo nem cliente: se faltar algo obrigatório ao pedido, pergunte antes.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        descricao: { type: "string" },
        prazo: { type: "string", description: "AAAA-MM-DD" },
        prioridade: { type: "string", enum: PRIORIDADES },
        responsavel_id: { type: "string" },
        projeto_id: { type: "string" },
        vinculo_tipo: { type: "string", enum: VINCULOS },
        vinculo_id: { type: "string" },
        vinculo_rotulo: { type: "string", description: "texto do vínculo, ex.: 'OS-2026-0012 · Cliente X'" },
        chave_idempotencia: { type: "string", description: "chave estável do pedido; impede duplicar se repetido" },
      },
      required: ["titulo"],
    },
  },
  {
    name: "atualizar_tarefa",
    description: "Ajusta prazo, prioridade, descrição ou responsável de uma tarefa existente.",
    input_schema: {
      type: "object",
      properties: {
        tarefa_id: { type: "string" },
        prazo: { type: "string", description: "AAAA-MM-DD" },
        prioridade: { type: "string", enum: PRIORIDADES },
        descricao: { type: "string" },
        responsavel_id: { type: "string" },
      },
      required: ["tarefa_id"],
    },
  },
  {
    name: "vincular_tarefa",
    description: "Liga uma tarefa a um registro do ERP (OS, obra, cliente, título, etc.).",
    input_schema: {
      type: "object",
      properties: {
        tarefa_id: { type: "string" },
        vinculo_tipo: { type: "string", enum: VINCULOS },
        vinculo_id: { type: "string" },
        vinculo_rotulo: { type: "string" },
      },
      required: ["tarefa_id", "vinculo_tipo", "vinculo_id"],
    },
  },
  {
    name: "concluir_tarefa",
    description: "Marca uma tarefa como concluída.",
    input_schema: { type: "object", properties: { tarefa_id: { type: "string" } }, required: ["tarefa_id"] },
  },
  {
    name: "comentar_tarefa",
    description: "Adiciona um comentário a uma tarefa.",
    input_schema: {
      type: "object",
      properties: {
        tarefa_id: { type: "string" },
        texto: { type: "string" },
        mencoes: { type: "array", items: { type: "string" }, description: "ids de perfis mencionados" },
      },
      required: ["tarefa_id", "texto"],
    },
  },
  {
    name: "notificar_usuario",
    description: "Envia um aviso (sino + push) para uma pessoa da empresa.",
    input_schema: {
      type: "object",
      properties: {
        dest_id: { type: "string" },
        texto: { type: "string" },
        tarefa_id: { type: "string" },
        os_id: { type: "string" },
      },
      required: ["dest_id", "texto"],
    },
  },
  {
    name: "criar_projeto_de_modelo",
    description: "Cria um projeto (e seu checklist) a partir de um modelo. Confirme o modelo com listar_modelos antes.",
    input_schema: {
      type: "object",
      properties: {
        modelo_id: { type: "string" },
        nome: { type: "string" },
        privado: { type: "boolean" },
        data_base: { type: "string", description: "AAAA-MM-DD; base dos prazos" },
      },
      required: ["modelo_id", "nome"],
    },
  },

  // ---- AMARELAS (OS) — viram um cartão de confirmação, não executam no loop ----
  {
    name: "criar_os",
    description: "Propõe criar uma Ordem de Serviço. Descubra o cliente e o responsável antes (buscar_os/listar_pessoas); não invente.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        cliente_id: { type: "string" },
        motivo: { type: "string" },
        local: { type: "string" },
        prazo: { type: "string", description: "AAAA-MM-DD" },
        responsavel_id: { type: "string" },
        urgencia: { type: "string", enum: ["baixa", "media", "alta"] },
        custo_estimado: { type: "number" },
      },
      required: ["titulo"],
    },
  },
  {
    name: "atribuir_responsavel",
    description: "Propõe definir o responsável de uma OS (notifica a pessoa ao confirmar).",
    input_schema: {
      type: "object",
      properties: { os_id: { type: "string" }, responsavel_id: { type: "string" } },
      required: ["os_id", "responsavel_id"],
    },
  },
  {
    name: "alterar_prazo_os",
    description: "Propõe mudar o prazo de uma OS.",
    input_schema: {
      type: "object",
      properties: { os_id: { type: "string" }, prazo: { type: "string", description: "AAAA-MM-DD" } },
      required: ["os_id", "prazo"],
    },
  },
  {
    name: "mudar_status_os",
    description: "Propõe iniciar, pausar ou retomar uma OS. Pausar exige motivo.",
    input_schema: {
      type: "object",
      properties: {
        os_id: { type: "string" },
        status: { type: "string", enum: ["a_fazer", "em_andamento", "pausada"] },
        motivo_pausa: { type: "string", enum: ["material", "cliente", "clima", "equipe", "outro"], description: "obrigatório se status=pausada" },
        pausa_obs: { type: "string" },
      },
      required: ["os_id", "status"],
    },
  },
  {
    name: "lancar_apontamento",
    description: "Propõe registrar horas de um colaborador numa OS.",
    input_schema: {
      type: "object",
      properties: {
        os_id: { type: "string" },
        colaborador_id: { type: "string" },
        horas: { type: "number" },
        tipo: { type: "string", enum: ["normal", "extra50", "extra100"] },
        data: { type: "string", description: "AAAA-MM-DD (padrão hoje)" },
        atividade_id: { type: "string" },
        observacao: { type: "string" },
      },
      required: ["os_id", "colaborador_id", "horas"],
    },
  },
  {
    name: "lancar_insumo_os",
    description: "Propõe registrar um material usado na OS.",
    input_schema: {
      type: "object",
      properties: {
        os_id: { type: "string" },
        descricao: { type: "string" },
        quantidade: { type: "number" },
        custo_unitario: { type: "number" },
        produto_id: { type: "string" },
      },
      required: ["os_id", "descricao"],
    },
  },
  {
    name: "concluir_os",
    description: "Propõe concluir uma OS (dispara a tarefa 'Faturar OS' para a gerência).",
    input_schema: { type: "object", properties: { os_id: { type: "string" } }, required: ["os_id"] },
  },

  // ---- FINANCEIRO · leitura (F0) ---------------------------------------------
  {
    name: "posicao_caixa",
    description: "Posição de caixa: saldo de cada conta + totais a receber/pagar em aberto e vencidos.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "buscar_titulos",
    description: "Busca títulos financeiros (contas a pagar/receber) que o usuário pode ver.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "trecho da descrição" },
        tipo: { type: "string", enum: ["pagar", "receber"] },
        status: { type: "string", enum: ["aberto", "pago", "cancelado"] },
        vencidos: { type: "boolean", description: "só abertos já vencidos" },
      },
    },
  },
  {
    name: "indicadores_financeiros",
    description: "Raio-x do caixa: runway, burn mensal, inadimplência, liquidez, projeção 30 dias, caixa livre.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "dre_resumo",
    description: "Resumo do DRE por competência (grupo, natureza, receita/despesa). Opcional: uma competência (AAAA-MM-01).",
    input_schema: { type: "object", properties: { competencia: { type: "string", description: "AAAA-MM-01" } } },
  },
  {
    name: "conferir_financeiro",
    description: "Checagens de compliance de dado: títulos sem categoria, sem vencimento e possíveis duplicidades.",
    input_schema: { type: "object", properties: {} },
  },

  // ---- FINANCEIRO · controle de caixa (F1) -----------------------------------
  {
    name: "criar_cobranca",
    description: "Cria uma tarefa de cobrança ligada a um título a receber. Use buscar_titulos para achar o título.",
    input_schema: {
      type: "object",
      properties: {
        titulo_id: { type: "string" },
        responsavel_id: { type: "string" },
        observacao: { type: "string" },
      },
      required: ["titulo_id"],
    },
  },
  {
    name: "salvar_cenario_caixa",
    description: "Salva um cenário do simulador de caixa (só metadados; não altera títulos nem saldos).",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        usar_saldo: { type: "boolean" },
        de: { type: "string", description: "AAAA-MM-DD" },
        ate: { type: "string", description: "AAAA-MM-DD" },
        titulo_ids: { type: "array", items: { type: "string" } },
      },
      required: ["nome"],
    },
  },
  {
    name: "criar_titulo",
    description: "Propõe criar um título (previsão a pagar/receber), sempre 'aberto'. NÃO dá baixa nem mexe em saldo. Vira cartão de confirmação.",
    input_schema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["pagar", "receber"] },
        descricao: { type: "string" },
        valor: { type: "number" },
        vencimento: { type: "string", description: "AAAA-MM-DD" },
        categoria_id: { type: "string" },
        cliente_id: { type: "string" },
        fornecedor_id: { type: "string" },
      },
      required: ["tipo", "descricao", "valor"],
    },
  },
  {
    name: "alterar_vencimento_titulo",
    description: "Propõe reagendar o vencimento de um título em aberto. Vira cartão de confirmação.",
    input_schema: {
      type: "object",
      properties: { titulo_id: { type: "string" }, vencimento: { type: "string", description: "AAAA-MM-DD" } },
      required: ["titulo_id", "vencimento"],
    },
  },
];
