// =============================================================================
// Perfis de acesso por módulo (V3 · Etapa 1).
// A trava real é o RLS do banco (migration 0040); aqui o app só decide o que
// mostrar no menu e quais rotas abrir. Mantenha nivelPadrao() igual ao SQL.
// =============================================================================

export type Papel = "super" | "admin" | "almoxarifado" | "logistica";
export type Nivel = "nenhum" | "ver" | "editar";
export type Modulo =
  | "comercial" | "financeiro" | "rh" | "estoque" | "requisicoes" | "compras" | "os" | "producao";

// "gerencia" = telas só da gerência (dashboards consolidados, custos, usuários)
export type Area = Modulo | "gerencia";

export const MODULOS: { key: Modulo; label: string; descricao: string }[] = [
  { key: "comercial", label: "Comercial", descricao: "CRM, propostas, contratos, precificador" },
  { key: "financeiro", label: "Financeiro", descricao: "Contas a pagar/receber, caixa, DRE" },
  { key: "rh", label: "RH / Folha", descricao: "Colaboradores, salários, folha, bônus" },
  { key: "estoque", label: "Estoque", descricao: "Produtos, depósitos, saldos, entradas e saídas" },
  { key: "requisicoes", label: "Requisições", descricao: "Abrir requisição de compra" },
  { key: "compras", label: "Compras", descricao: "Cotação, pedido e recebimento" },
  { key: "os", label: "OS / Obras", descricao: "Ordens de serviço, obras, alocação" },
  { key: "producao", label: "Produção", descricao: "Lançamentos, peças, serviços, demandas" },
];

export const PAPEIS: { key: Papel; label: string }[] = [
  { key: "admin", label: "Gerência" },
  { key: "almoxarifado", label: "Almoxarifado" },
  { key: "logistica", label: "Logística" },
];

// papéis cuja matriz a gerência pode ajustar
export const PAPEIS_CONFIGURAVEIS: Papel[] = ["almoxarifado", "logistica"];

export function papelLabel(p?: string | null): string {
  if (p === "super") return "Admin central";
  return PAPEIS.find((x) => x.key === p)?.label ?? p ?? "—";
}

export function isGerencia(papel?: string | null): boolean {
  return papel === "super" || papel === "admin";
}

export function nivelPadrao(papel: string, modulo: Modulo): Nivel {
  if (isGerencia(papel)) return "editar";
  if (papel === "almoxarifado") {
    return ({ estoque: "editar", requisicoes: "editar", compras: "editar", os: "ver", producao: "ver" } as Partial<Record<Modulo, Nivel>>)[modulo] ?? "nenhum";
  }
  if (papel === "logistica") {
    return ({ os: "editar", requisicoes: "editar", estoque: "ver", producao: "ver" } as Partial<Record<Modulo, Nivel>>)[modulo] ?? "nenhum";
  }
  return "nenhum";
}

export type Acesso = {
  papel: Papel | null;
  gerencia: boolean;
  niveis: Record<Modulo, Nivel>;
  userId?: string;
  empresaId?: string | null;   // empresa em uso (modo suporte do super incluso)
};

export function montarAcesso(papel: string | null, overrides: { modulo: string; nivel: string }[] = []): Acesso {
  const niveis = {} as Record<Modulo, Nivel>;
  for (const m of MODULOS) {
    const o = isGerencia(papel) ? undefined : overrides.find((x) => x.modulo === m.key);
    niveis[m.key] = papel ? ((o?.nivel as Nivel) ?? nivelPadrao(papel, m.key)) : "nenhum";
  }
  return { papel: (papel as Papel) ?? null, gerencia: isGerencia(papel), niveis };
}

// ---- tabela → módulo que a escreve (entidades genéricas /e/[tabela]) ---------
// Leitura cruzada (ex.: logística vê clientes numa OS) é tratada pelo RLS;
// para o menu vale o módulo "dono" da tabela.
const TABELA_MODULO: Record<string, Area> = {
  clientes: "comercial", contatos: "comercial", interacoes: "comercial", oportunidades: "comercial",
  propostas: "comercial", itens_proposta: "comercial", contratos: "comercial", faturamento: "comercial",
  tarefas_followup: "comercial", documentos: "comercial", manutencao_recorrente: "comercial",
  composicao_custo: "comercial", parametros_preco: "comercial",
  titulos_financeiros: "financeiro", movimentacoes_caixa: "financeiro", contas_bancarias: "financeiro",
  categorias_financeiras: "financeiro", subcategorias_financeiras: "financeiro", simulacoes_caixa: "financeiro",
  colaboradores: "rh", bonus_regras: "rh", bonus_producao: "rh",
  produtos: "estoque", depositos: "estoque", fornecedores: "estoque",
  movimentacoes_estoque: "estoque", consumo_producao: "estoque",
  requisicoes_compra: "requisicoes", itens_requisicao_compra: "requisicoes",
  cotacoes_compra: "compras", itens_cotacao: "compras", cotacao_fornecedores: "compras",
  cotacao_precos: "compras", pedidos_compra: "compras", itens_pedido_compra: "compras",
  ordens_servico: "os", atividades_os: "os", insumos_os: "os",
  obras_servicos: "os", alocacao_equipe: "os", materiais_por_obra: "os",
  pecas: "producao", servicos: "producao", producao: "producao", demandas: "producao",
};

// ---- rota → área (prefixo mais longo vence) -------------------------------------
const ROTAS: [string, Area][] = [
  ["/propostas", "comercial"], ["/contratos", "comercial"], ["/precificador", "comercial"],
  ["/financeiro", "financeiro"],
  ["/rh", "rh"], ["/bonus", "rh"],
  ["/estoque", "estoque"],
  ["/compras/requisicao", "requisicoes"], ["/compras", "compras"],
  ["/os", "os"], ["/obras", "os"],
  ["/impacto", "producao"],
  ["/producao/custos", "gerencia"], ["/gerencial", "gerencia"], ["/relatorios", "gerencia"],
  ["/equipe", "gerencia"], ["/tarefas/automacoes", "gerencia"], ["/tarefas/painel", "gerencia"],
];

export function areaDaRota(pathname: string): Area | null {
  if (pathname.startsWith("/e/")) return TABELA_MODULO[pathname.split("/")[2]] ?? "gerencia";
  let melhor: [string, Area] | null = null;
  for (const r of ROTAS) {
    if ((pathname === r[0] || pathname.startsWith(r[0] + "/")) && (!melhor || r[0].length > melhor[0].length)) melhor = r;
  }
  return melhor ? melhor[1] : null;   // null = livre (painel, tarefas…)
}

export function podeArea(acesso: Acesso, area: Area | null, nivel: "ver" | "editar" = "ver"): boolean {
  if (area === null) return true;
  if (acesso.gerencia) return true;
  if (area === "gerencia") return false;
  const n = acesso.niveis[area];
  return nivel === "editar" ? n === "editar" : n !== "nenhum";
}

export function podeRota(acesso: Acesso, pathname: string): boolean {
  if (pathname === "/admin") return acesso.papel === "super";
  return podeArea(acesso, areaDaRota(pathname));
}
