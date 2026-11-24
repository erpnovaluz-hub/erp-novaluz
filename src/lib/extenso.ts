// Valor monetário por extenso (pt-BR), ex.: 1234.5 → "mil, duzentos e trinta e quatro reais e cinquenta centavos"
const UN = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze",
  "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CEM = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CEM[c]);
  if (r) partes.push(r < 20 ? UN[r] : [DEZ[Math.floor(r / 10)], UN[r % 10]].filter(Boolean).join(" e "));
  return partes.join(" e ");
}

function inteiro(n: number): string {
  if (n === 0) return "zero";
  const grupos: number[] = [];
  while (n > 0) { grupos.push(n % 1000); n = Math.floor(n / 1000); }
  const nomes = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
  const partes: string[] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let txt = i === 1 && g === 1 ? "mil" : ate999(g);
    if (i >= 1 && !(i === 1 && g === 1)) txt += " " + nomes[i][g === 1 ? 0 : 1];
    partes.push(txt);
  }
  // "e" antes do último grupo quando ele é < 100 ou centena redonda
  if (partes.length > 1) {
    const ult = grupos[0];
    if (ult && (ult < 100 || ult % 100 === 0)) {
      const last = partes.pop()!;
      return partes.join(" ") + " e " + last;
    }
  }
  return partes.join(" ");
}

export function valorPorExtenso(valor: number): string {
  const centavosTot = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTot / 100), cent = centavosTot % 100;
  const partes: string[] = [];
  if (reais) {
    const txt = inteiro(reais);
    const de = reais >= 1_000_000 && reais % 1_000_000 === 0 ? " de" : "";
    partes.push(`${txt}${de} ${reais === 1 ? "real" : "reais"}`);
  }
  if (cent) partes.push(`${inteiro(cent)} ${cent === 1 ? "centavo" : "centavos"}`);
  if (!partes.length) return "zero real";
  return partes.join(" e ");
}
