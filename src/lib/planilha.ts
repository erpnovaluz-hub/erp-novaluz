// =============================================================================
// Leitura de planilha colada (Excel/Google Sheets copiam como texto com TAB).
// Também aceita CSV com ";" ou ",". Números no formato brasileiro ("1.234,5").
// =============================================================================

export type Tabela = { cabecalho: string[]; linhas: string[][] };

export function lerColado(texto: string, temCabecalho = true): Tabela {
  const brutas = texto.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (brutas.length === 0) return { cabecalho: [], linhas: [] };
  const sep = brutas.some((l) => l.includes("\t")) ? "\t" : brutas.some((l) => l.includes(";")) ? ";" : ",";
  const cel = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
  const todas = brutas.map(cel);
  const n = Math.max(...todas.map((l) => l.length));
  const cabecalho = temCabecalho ? todas[0] : Array.from({ length: n }, (_, i) => `Coluna ${i + 1}`);
  return { cabecalho, linhas: temCabecalho ? todas.slice(1) : todas };
}

// "1.234,56" → 1234.56 · "12,5" → 12.5 · "12.5" → 12.5 · "1.200" → 1200 · "R$ 3,00" → 3 · "" → null
export function numeroBR(s: string | undefined | null): number | null {
  if (s == null) return null;
  let t = String(s).trim().replace(/[R$\s]/g, "");
  if (t === "" || t === "-") return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, "");   // "1.234.567"
  else if (/^-?[1-9]\d{0,2}\.\d{3}$/.test(t)) t = t.replace(".", "");     // "1.200" = mil e duzentos (padrão BR); "0.125" fica decimal
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

// comparação sem acento/caixa/espaços duplicados
export function normalizar(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// adivinha qual coluna é qual pelo nome do cabeçalho
export function adivinharColuna(cabecalho: string[], padroes: RegExp[]): number {
  const h = cabecalho.map(normalizar);
  for (const p of padroes) {
    const i = h.findIndex((x) => p.test(x));
    if (i >= 0) return i;
  }
  return -1;
}
