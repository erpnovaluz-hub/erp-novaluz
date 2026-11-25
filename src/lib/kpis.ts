// =============================================================================
// Ritmo de Gestão · Bloco 2 — metas e KPIs (migration 0071).
// Spec: docs/ritmo-gestao/bloco2-spec.md
// Farol calculado aqui (espelha a regra da spec §4).
// =============================================================================

export type Unidade = "pct" | "brl" | "meses" | "numero" | "dias";
export type Sentido = "maior" | "menor";
export type Segmento = "montagem_industrial" | "metalurgia" | "servicos" | "outro";
export type Farol = "verde" | "amarelo" | "vermelho" | "sem_meta" | "sem_dado";

export type Catalogo = {
  chave: string; nome: string; descricao: string; decisao: string; formula: string;
  unidade: Unidade; sentido: Sentido; coleta: "automatico" | "manual"; foto: boolean;
  financeiro: boolean; segmentos: string[]; aviso: string | null; ordem: number;
};
export type Kpi = {
  id: string; catalogo_chave: string | null; nome: string; descricao: string | null;
  unidade: Unidade; sentido: Sentido; responsavel_id: string | null; meta: number | null;
  tolerancia: number; ativo: boolean; ordem: number;
};
export type Medicao = {
  kpi_id: string; periodo: string; valor: number | null; origem: "automatico" | "manual";
  observacao: string | null; registrado_por: string | null; atualizado_em: string;
};

export const SEGMENTOS: { key: Segmento; label: string }[] = [
  { key: "montagem_industrial", label: "Montagem industrial" },
  { key: "metalurgia", label: "Metalurgia / fabricação" },
  { key: "servicos", label: "Serviços" },
  { key: "outro", label: "Outro" },
];

export const UNIDADES: { key: Unidade; label: string }[] = [
  { key: "pct", label: "%" }, { key: "numero", label: "número" }, { key: "dias", label: "dias" },
  { key: "meses", label: "meses" }, { key: "brl", label: "R$" },
];

export const DOSE_MAXIMA = 5;   // "mais de 5 indicadores ninguém acompanha"

export function farol(valor: number | null | undefined, k: Pick<Kpi, "meta" | "tolerancia" | "sentido">): Farol {
  if (valor == null) return "sem_dado";
  if (k.meta == null) return "sem_meta";
  const faixa = Math.abs(k.meta) * (k.tolerancia ?? 10) / 100;
  if (k.sentido === "maior") {
    if (valor >= k.meta) return "verde";
    return valor >= k.meta - faixa ? "amarelo" : "vermelho";
  }
  if (valor <= k.meta) return "verde";
  return valor <= k.meta + faixa ? "amarelo" : "vermelho";
}

// status nunca só por cor: ícone + rótulo
export const FAROL: Record<Farol, { label: string; icone: string; cls: string; ordem: number }> = {
  vermelho: { label: "Fora da meta", icone: "▼", cls: "bg-red-100 text-red-800 ring-red-200", ordem: 0 },
  amarelo: { label: "Atenção", icone: "▲", cls: "bg-amber-100 text-amber-800 ring-amber-200", ordem: 1 },
  sem_meta: { label: "Medindo linha de base", icone: "📏", cls: "bg-gray-100 text-gray-600 ring-gray-200", ordem: 2 },
  sem_dado: { label: "Sem dado", icone: "–", cls: "bg-gray-50 text-gray-400 ring-gray-200", ordem: 3 },
  verde: { label: "Na meta", icone: "✓", cls: "bg-green-100 text-green-800 ring-green-200", ordem: 4 },
};

export function formatarValor(v: number | null | undefined, u: Unidade): string {
  if (v == null) return "—";
  const n = (d: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  switch (u) {
    case "pct": return `${n(1)}%`;
    case "brl": return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
    case "meses": return `${n(1)} ${Math.abs(v) === 1 ? "mês" : "meses"}`;
    case "dias": return `${n(0)} ${Math.abs(v) === 1 ? "dia" : "dias"}`;
    default: return n(2);
  }
}

// ---- meses -------------------------------------------------------------------
export function mesISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
export function mesAtual(): string { return mesISO(new Date()); }
export function somaMeses(iso: string, n: number): string {
  const [a, m] = iso.split("-").map(Number);
  return mesISO(new Date(a, m - 1 + n, 1));
}
export function rotuloMes(iso: string, curto = false): string {
  const [a, m] = iso.split("-").map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString("pt-BR", curto ? { month: "short" } : { month: "long", year: "numeric" });
  return s.replace(".", "");
}
// últimos n meses terminando em `ate` (inclusive), do mais antigo ao mais novo
export function janelaMeses(ate: string, n = 6): string[] {
  return Array.from({ length: n }, (_, i) => somaMeses(ate, i - (n - 1)));
}
