// =============================================================================
// Tarefas (V3 · Etapa 2) — tipos, vínculos com o ERP e helpers de prazo.
// Tabelas: projetos, secoes_projeto, tarefas (+ vw_tarefas com contagem de
// subtarefas). Visibilidade no RLS (migration 0041).
// =============================================================================
import type { Option } from "@/lib/entities";
import type { Modulo } from "@/lib/permissoes";

export type Projeto = {
  id: string; nome: string; descricao: string | null; cor: string;
  privado: boolean; dono_id: string | null; arquivado: boolean; criado_em: string;
};
export type Secao = { id: string; projeto_id: string; nome: string; ordem: number };
export type Tarefa = {
  id: string; projeto_id: string | null; secao_id: string | null; parent_id: string | null;
  titulo: string; descricao: string | null; responsavel_id: string | null; criado_por: string | null;
  prazo: string | null; prioridade: Prioridade; concluida: boolean; concluida_em: string | null;
  ordem: number; vinculo_tipo: VinculoTipo | null; vinculo_id: string | null; vinculo_rotulo: string | null;
  criado_em: string; n_sub?: number; n_sub_ok?: number;
  origem?: "automacao" | "followup_crm" | "modelo" | null;
  inicio?: string | null;
};
export type Pessoa = { id: string; nome: string | null; email: string | null };

export type Prioridade = "baixa" | "media" | "alta" | "urgente";
export const PRIORIDADES: Option[] = [
  { value: "baixa", label: "Baixa", color: "gray" },
  { value: "media", label: "Média", color: "blue" },
  { value: "alta", label: "Alta", color: "orange" },
  { value: "urgente", label: "Urgente", color: "red" },
];

export const CORES: Record<string, string> = {
  teal: "#14b8a6", blue: "#3b82f6", purple: "#8b5cf6", pink: "#ec4899", red: "#ef4444",
  orange: "#f97316", amber: "#f59e0b", green: "#22c55e", gray: "#6b7280",
};

// ---- vínculo com registros do ERP ------------------------------------------------
export type VinculoTipo = "os" | "obra" | "cliente" | "oportunidade" | "proposta" | "titulo" | "requisicao" | "pedido";

type VinculoDef = {
  tipo: VinculoTipo; label: string; icon: string; modulo: Modulo;
  tabela: string; colunas: string; busca: string; ordem: string;
  rotulo: (r: any) => string;
  href: (id: string) => string;
};

export const VINCULOS: VinculoDef[] = [
  { tipo: "os", label: "Ordem de serviço", icon: "🧷", modulo: "os", tabela: "ordens_servico", colunas: "id, numero, titulo",
    busca: "titulo", ordem: "numero", rotulo: (r) => [r.numero, r.titulo].filter(Boolean).join(" · "), href: (id) => `/os/${id}` },
  { tipo: "obra", label: "Obra", icon: "🏗️", modulo: "os", tabela: "obras_servicos", colunas: "id, local, tipo_servico",
    busca: "local", ordem: "local", rotulo: (r) => [r.local, r.tipo_servico].filter(Boolean).join(" · "), href: () => `/e/obras_servicos` },
  { tipo: "cliente", label: "Cliente", icon: "🏢", modulo: "comercial", tabela: "clientes", colunas: "id, nome",
    busca: "nome", ordem: "nome", rotulo: (r) => r.nome, href: () => `/e/clientes` },
  { tipo: "oportunidade", label: "Oportunidade", icon: "🎯", modulo: "comercial", tabela: "oportunidades", colunas: "id, titulo",
    busca: "titulo", ordem: "titulo", rotulo: (r) => r.titulo, href: () => `/e/oportunidades` },
  { tipo: "proposta", label: "Proposta", icon: "📑", modulo: "comercial", tabela: "propostas", colunas: "id, numero, objeto",
    busca: "numero", ordem: "numero", rotulo: (r) => [r.numero, r.objeto].filter(Boolean).join(" · "), href: (id) => `/propostas/${id}` },
  { tipo: "titulo", label: "Título financeiro", icon: "💰", modulo: "financeiro", tabela: "titulos_financeiros", colunas: "id, descricao, vencimento",
    busca: "descricao", ordem: "vencimento", rotulo: (r) => r.descricao, href: () => `/e/titulos_financeiros` },
  { tipo: "requisicao", label: "Requisição de compra", icon: "📝", modulo: "requisicoes", tabela: "requisicoes_compra", colunas: "id, numero, observacao",
    busca: "numero", ordem: "numero", rotulo: (r) => [r.numero, r.observacao].filter(Boolean).join(" · "), href: (id) => `/compras/requisicao/${id}` },
  { tipo: "pedido", label: "Pedido de compra", icon: "🛒", modulo: "compras", tabela: "pedidos_compra", colunas: "id, numero, observacao",
    busca: "numero", ordem: "numero", rotulo: (r) => [r.numero, r.observacao].filter(Boolean).join(" · "), href: (id) => `/compras/pedido/${id}` },
];

export function vinculoDef(tipo: string | null | undefined): VinculoDef | undefined {
  return VINCULOS.find((v) => v.tipo === tipo);
}

// ---- prazo ----------------------------------------------------------------------
export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function somaDias(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type Faixa = "atrasadas" | "hoje" | "semana" | "depois" | "sem_prazo";
export const FAIXAS: { key: Faixa; label: string }[] = [
  { key: "atrasadas", label: "Atrasadas" },
  { key: "hoje", label: "Hoje" },
  { key: "semana", label: "Próximos 7 dias" },
  { key: "depois", label: "Mais tarde" },
  { key: "sem_prazo", label: "Sem prazo" },
];

export function faixaDoPrazo(prazo: string | null): Faixa {
  if (!prazo) return "sem_prazo";
  const hoje = hojeISO();
  if (prazo < hoje) return "atrasadas";
  if (prazo === hoje) return "hoje";
  if (prazo <= somaDias(hoje, 7)) return "semana";
  return "depois";
}

// "Hoje", "Amanhã", "seg, 28/09" …
export function rotuloPrazo(prazo: string | null): string {
  if (!prazo) return "";
  const hoje = hojeISO();
  if (prazo === hoje) return "Hoje";
  if (prazo === somaDias(hoje, 1)) return "Amanhã";
  if (prazo === somaDias(hoje, -1)) return "Ontem";
  const d = new Date(prazo + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export function corPrazo(prazo: string | null, concluida: boolean): string {
  if (!prazo || concluida) return "text-gray-500";
  const hoje = hojeISO();
  if (prazo < hoje) return "text-red-600 font-medium";
  if (prazo === hoje) return "text-amber-600 font-medium";
  return "text-gray-600";
}

export function nomeCurto(p?: Pessoa | null): string {
  if (!p) return "";
  return (p.nome || p.email || "").split(" ")[0];
}

export function iniciais(p?: Pessoa | null): string {
  const n = (p?.nome || p?.email || "?").trim();
  const partes = n.split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

// ---- automações (migration 0043) -------------------------------------------------
export type Gatilho = "requisicao_aberta" | "pedido_emitido" | "os_aberta" | "titulo_vencendo" | "proposta_sem_retorno" | "estoque_minimo";

export const AUTOMACOES: {
  gatilho: Gatilho; icon: string; titulo: string; quando: string; cria: string;
  tipo: "evento" | "rotina"; parametro?: string; usaModelo?: boolean;
}[] = [
  { gatilho: "requisicao_aberta", icon: "📝", tipo: "evento", titulo: "Requisição aberta",
    quando: "Alguém abre uma requisição de compra", cria: "“Cotar RC-…” — conclui sozinha quando vira pedido" },
  { gatilho: "pedido_emitido", icon: "🛒", tipo: "evento", titulo: "Pedido emitido",
    quando: "Um pedido de compra é gerado", cria: "“Receber e conferir PED-…” — conclui sozinha quando o pedido é recebido" },
  { gatilho: "os_aberta", icon: "🧷", tipo: "evento", titulo: "OS aberta", usaModelo: true,
    quando: "Uma ordem de serviço é criada", cria: "“Executar OS-…” com o checklist do modelo como subtarefas" },
  { gatilho: "titulo_vencendo", icon: "💰", tipo: "rotina", titulo: "Título vencendo", parametro: "dias antes do vencimento",
    quando: "Conta a pagar ou a receber perto de vencer (ou vencida)", cria: "“Pagar: …” / “Receber: …” com prazo no vencimento" },
  { gatilho: "proposta_sem_retorno", icon: "📑", tipo: "rotina", titulo: "Proposta sem retorno", parametro: "dias depois da data da proposta",
    quando: "Proposta com status Enviada há X dias", cria: "“Follow-up da proposta …” (uma por proposta)" },
  { gatilho: "estoque_minimo", icon: "📦", tipo: "rotina", titulo: "Estoque abaixo do mínimo",
    quando: "Saldo somado dos depósitos fica abaixo do mínimo do produto", cria: "“Repor estoque: …” (nova só depois de concluir a anterior)" },
];
