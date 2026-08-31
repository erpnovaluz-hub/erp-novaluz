// Deriva o tipo de bônus (LD/LP/LPP) a partir do nome/código da peça.
// Regra da planilha MSFORT (validada em 100% do catálogo):
//   • começa com "LD"           -> LD
//   • família "LP": tamanho ≥ 200 -> LP ; < 200 -> LPP
// Peças fora do padrão retornam "" (sem tipo) — aí o tipo do cadastro/lançamento manda.
export type TipoBonus = "LD" | "LP" | "LPP";

export function tipoDaPeca(nome?: string | null): TipoBonus | "" {
  if (!nome) return "";
  const up = String(nome).trim().toUpperCase();
  if (up.startsWith("LD")) return "LD";
  if (up.startsWith("LP")) {
    const m = up.match(/([0-9]+(?:[.,][0-9]+)?)/);
    if (!m) return "";
    const n = parseFloat(m[1].replace(",", "."));
    if (isNaN(n)) return "";
    return n >= 200 ? "LP" : "LPP";
  }
  return "";
}
