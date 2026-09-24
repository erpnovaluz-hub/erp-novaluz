// =============================================================================
// Ferramentas e equipamentos (patrimônio) — migration 0048
// =============================================================================
import type { Option } from "@/lib/entities";

export type Ferramenta = {
  id: string; codigo: string; descricao: string; categoria: string; marca: string | null; modelo: string | null;
  numero_serie: string | null; valor_aquisicao: number | null; data_aquisicao: string | null;
  deposito_id: string | null; status: StatusFerramenta; estado: string; foto_caminho: string | null;
  proxima_manutencao: string | null; periodicidade_dias: number | null; observacao: string | null;
  // vw_ferramentas_local
  deposito_nome?: string | null; cautela_id?: string | null; cautela_numero?: string | null;
  com_colaborador_id?: string | null; com_colaborador_nome?: string | null; destino_tipo?: string | null;
  destino_nome?: string | null; data_saida?: string | null; previsao_devolucao?: string | null; atrasada?: boolean | null;
};
export type StatusFerramenta = "disponivel" | "em_uso" | "manutencao" | "extraviada" | "baixada";

export const CATEGORIAS: Option[] = [
  { value: "ferramenta_manual", label: "Ferramenta manual" },
  { value: "ferramenta_eletrica", label: "Ferramenta elétrica" },
  { value: "equipamento", label: "Equipamento" },
  { value: "instrumento_medicao", label: "Instrumento de medição" },
  { value: "epi_duravel", label: "EPI durável" },
  { value: "veiculo", label: "Veículo" },
  { value: "outro", label: "Outro" },
];
export const STATUS_FERR: Option[] = [
  { value: "disponivel", label: "Disponível", color: "green" },
  { value: "em_uso", label: "Em uso", color: "blue" },
  { value: "manutencao", label: "Manutenção", color: "amber" },
  { value: "extraviada", label: "Extraviada", color: "red" },
  { value: "baixada", label: "Baixada", color: "gray" },
];
export const ESTADOS: Option[] = [
  { value: "novo", label: "Novo" }, { value: "bom", label: "Bom" },
  { value: "regular", label: "Regular" }, { value: "ruim", label: "Ruim" },
];
export const ESTADOS_DEVOLUCAO: Option[] = [
  { value: "bom", label: "Bom", color: "green" },
  { value: "regular", label: "Regular", color: "blue" },
  { value: "ruim", label: "Ruim (desgastada)", color: "amber" },
  { value: "danificada", label: "Danificada → manutenção", color: "red" },
  { value: "extraviada", label: "Não voltou (extraviada)", color: "red" },
];
export const EVENTO_ICON: Record<string, string> = {
  cadastro: "🆕", cautela: "📤", devolucao: "↩️", manutencao_envio: "🛠️", manutencao_retorno: "✅",
  extravio: "❓", baixa: "🗑️", reativacao: "♻️", edicao: "✏️",
};

export const catLabel = (v: string | null | undefined) => CATEGORIAS.find((c) => c.value === v)?.label ?? v ?? "—";

// o QR da etiqueta abre /f/CODIGO (curto = QR menos denso, cabe em etiqueta pequena)
export const urlEtiqueta = (codigo: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/f/${encodeURIComponent(codigo)}`;

// aceita a URL da etiqueta ou só o código digitado
export function codigoDoQr(texto: string): string | null {
  const t = texto.trim();
  const m = t.match(/\/f\/([^/?#\s]+)/i);
  if (m) return decodeURIComponent(m[1]).toUpperCase();
  if (/^[A-Z0-9][A-Z0-9\-_.]{1,30}$/i.test(t)) return t.toUpperCase();
  return null;
}
