// =============================================================================
// Almoxarifado — vales do balcão (migration 0046)
// =============================================================================
import type { Option } from "@/lib/entities";

export type TipoVale = "saida" | "devolucao" | "entrada";
export type DestinoTipo = "os" | "obra" | "setor";

export const TIPOS_VALE: { key: TipoVale; label: string; icon: string; titulo: string; prefixo: string }[] = [
  { key: "saida", label: "Saída", icon: "📤", titulo: "Vale de saída de material", prefixo: "VS" },
  { key: "devolucao", label: "Devolução", icon: "↩️", titulo: "Vale de devolução de material", prefixo: "VD" },
  { key: "entrada", label: "Entrada avulsa", icon: "📥", titulo: "Entrada avulsa de material", prefixo: "VE" },
];

export const TIPO_VALE_OPTS: Option[] = [
  { value: "saida", label: "Saída", color: "red" },
  { value: "devolucao", label: "Devolução", color: "blue" },
  { value: "entrada", label: "Entrada avulsa", color: "green" },
];
export const STATUS_VALE_OPTS: Option[] = [
  { value: "ativo", label: "Registrado", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];

export const DESTINOS: { key: DestinoTipo; label: string; icon: string }[] = [
  { key: "os", label: "OS", icon: "🧷" },
  { key: "obra", label: "Obra", icon: "🏗️" },
  { key: "setor", label: "Setor", icon: "🏷️" },
];

export const qtdBR = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
