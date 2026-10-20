// =============================================================================
// Ordens de serviço — status e fluxo (migration 0051). Fonte única para telas.
// =============================================================================
import type { Option } from "@/lib/entities";

export type StatusOS = "orcamento" | "a_fazer" | "em_andamento" | "pausada" | "concluido" | "faturada" | "cancelado";

// ordem = colunas do quadro
export const STATUS_OS: Option[] = [
  { value: "orcamento", label: "Orçamento", color: "purple" },
  { value: "a_fazer", label: "Aprovada / a fazer", color: "gray" },
  { value: "em_andamento", label: "Em execução", color: "blue" },
  { value: "pausada", label: "Pausada", color: "amber" },
  { value: "concluido", label: "Concluída", color: "green" },
  { value: "faturada", label: "Faturada", color: "green" },
  { value: "cancelado", label: "Cancelada", color: "gray" },
];

export const MOTIVOS_PAUSA: Option[] = [
  { value: "material", label: "Aguardando material" },
  { value: "cliente", label: "Aguardando cliente" },
  { value: "clima", label: "Clima / condições do local" },
  { value: "equipe", label: "Falta de equipe" },
  { value: "outro", label: "Outro" },
];

// OS que ainda recebem material, ferramenta e apontamento
export const STATUS_OS_ATIVOS: StatusOS[] = ["a_fazer", "em_andamento", "pausada"];
// OS que contam como "em aberto" nos painéis
export const STATUS_OS_ABERTOS: StatusOS[] = ["orcamento", "a_fazer", "em_andamento", "pausada"];

export const statusOSLabel = (s: string | null | undefined) => STATUS_OS.find((x) => x.value === s)?.label ?? s ?? "—";
export const motivoPausaLabel = (s: string | null | undefined) => MOTIVOS_PAUSA.find((x) => x.value === s)?.label ?? s ?? "";

export function osAtrasada(o: { prazo?: string | null; status?: string | null }) {
  if (!o.prazo || !STATUS_OS_ABERTOS.includes(o.status as StatusOS)) return false;
  const d = new Date();
  const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return o.prazo < hoje;
}

// texto do aviso "OS-… · título → pausada (material)" → "Pausada (Aguardando material)"
export function rotuloMudancaStatus(texto: string | null | undefined): string {
  const fim = (texto ?? "").split("→").pop()?.trim() ?? "";
  const m = fim.match(/^([a-z_]+)(?:\s*\(([a-z_]+)\))?$/);
  if (!m) return fim;
  return statusOSLabel(m[1]) + (m[2] ? ` (${motivoPausaLabel(m[2])})` : "");
}
