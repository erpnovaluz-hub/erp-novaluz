// =============================================================================
// Leitura de extrato bancário — OFX e CSV, sem IA (rápido, grátis, exato).
// PDF e CSV que não deu para entender vão para a IA (conciliacao.ts).
// Valor com sinal: + entrada (crédito) / - saída (débito).
// =============================================================================

export type LinhaExtrato = {
  data: string; // AAAA-MM-DD
  valor: number; // + crédito / - débito
  descricao: string;
  documento: string | null;
  fitid?: string | null;
};

export type ExtratoLido = {
  linhas: LinhaExtrato[];
  saldo_final: number | null;
  periodo_de: string | null;
  periodo_ate: string | null;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

// "1.234,56" | "-1234.56" | "1.234,56 D" | "(1.234,56)" | "R$ 50,16" → número
export function numeroBR(s: string): number | null {
  let t = String(s ?? "").trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/\s*D$/i.test(t)) { neg = true; t = t.replace(/\s*D$/i, ""); }
  t = t.replace(/\s*C$/i, "").replace(/R\$\s*/i, "").replace(/\s/g, "");
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); }
  if (t.endsWith("-")) { neg = !neg; t = t.slice(0, -1); }
  if (t.startsWith("+")) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t)) return null;
  const ultVirg = t.lastIndexOf(","), ultPonto = t.lastIndexOf(".");
  if (ultVirg > ultPonto) t = t.replace(/\./g, "").replace(",", "."); // 1.234,56
  else if (ultPonto > ultVirg && ultVirg >= 0) t = t.replace(/,/g, ""); // 1,234.56
  else if (ultVirg < 0 && (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, ""); // 1.234.567
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return r2(neg ? -n : n);
}

// dd/mm/aaaa | dd/mm/aa | aaaa-mm-dd | dd-mm-aaaa | aaaammdd → AAAA-MM-DD
export function dataBR(s: string): string | null {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) {
    const ano = m[3].length === 2 ? "20" + m[3] : m[3];
    const d = m[1].padStart(2, "0"), mm = m[2].padStart(2, "0");
    if (Number(mm) < 1 || Number(mm) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return `${ano}-${mm}-${d}`;
  }
  m = t.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Linhas de saldo que alguns bancos misturam com os lançamentos
const EH_SALDO = /^\s*(saldo|sdo)\b|saldo (anterior|do dia|final|disponivel|disponível|em conta)/i;

// ---- OFX ---------------------------------------------------------------------
export function lerOFX(txt: string): ExtratoLido {
  const tag = (bloco: string, nome: string) => {
    const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, "i"));
    return m ? m[1].trim() : "";
  };
  const linhas: LinhaExtrato[] = [];
  const blocos = txt.split(/<STMTTRN>/i).slice(1);
  for (const b0 of blocos) {
    const b = b0.split(/<\/STMTTRN>/i)[0];
    const data = dataBR(tag(b, "DTPOSTED"));
    const valor = numeroBR(tag(b, "TRNAMT"));
    if (!data || valor === null || valor === 0) continue;
    const memo = tag(b, "MEMO"), nome = tag(b, "NAME");
    const descricao = [nome, memo].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" · ") || tag(b, "TRNTYPE");
    if (EH_SALDO.test(descricao)) continue;
    linhas.push({
      data, valor, descricao,
      documento: tag(b, "CHECKNUM") || tag(b, "REFNUM") || null,
      fitid: tag(b, "FITID") || null,
    });
  }
  const ledger = txt.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i);
  return {
    linhas,
    saldo_final: ledger ? numeroBR(ledger[1]) : null,
    periodo_de: dataBR(txt.match(/<DTSTART>([^<\r\n]*)/i)?.[1] ?? "") ?? minData(linhas),
    periodo_ate: dataBR(txt.match(/<DTEND>([^<\r\n]*)/i)?.[1] ?? "") ?? maxData(linhas),
  };
}

// ---- CSV ---------------------------------------------------------------------
function separarCSV(linha: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') { cur += '"'; i++; } else aspas = !aspas;
    } else if (c === sep && !aspas) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Detecta separador e colunas pelo cabeçalho; sem cabeçalho, por conteúdo.
export function lerCSV(txt: string): ExtratoLido {
  const brutas = txt.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!brutas.length) return { linhas: [], saldo_final: null, periodo_de: null, periodo_ate: null };
  const amostra = brutas.slice(0, 15).join("\n");
  const sep = [";", "\t", ","].map((s) => ({ s, n: amostra.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
  const rows = brutas.map((l) => separarCSV(l, sep));

  // cabeçalho: 1ª linha (entre as 15 primeiras) com coluna de data e de valor/crédito
  let iData = -1, iDesc = -1, iValor = -1, iCred = -1, iDeb = -1, iDoc = -1, iTipo = -1, inicio = 0;
  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const h = rows[r].map(sem);
    const achar = (re: RegExp) => h.findIndex((x) => re.test(x));
    const d = achar(/^(data|date|dt)\b|data (do )?(lanc|mov)/);
    const v = achar(/^(valor|value|amount|montante|vlr)\b/);
    const c = achar(/credito|entrada/);
    const db = achar(/debito|saida/);
    if (d >= 0 && (v >= 0 || (c >= 0 && db >= 0))) {
      iData = d; iValor = v; iCred = v >= 0 ? -1 : c; iDeb = v >= 0 ? -1 : db;
      iDesc = achar(/hist|descri|memo|lancamento|detalhe|estabelec|titulo/);
      iDoc = achar(/^(doc|documento|n.? ?doc|numero)/);
      iTipo = achar(/^(tipo|d\/c|c\/d|natureza)$/);
      inicio = r + 1;
      break;
    }
  }

  const linhas: LinhaExtrato[] = [];
  for (const cols of rows.slice(inicio)) {
    let data: string | null, valor: number | null, descricao: string, documento: string | null = null;
    if (iData >= 0) {
      data = dataBR(cols[iData] ?? "");
      if (iValor >= 0) valor = numeroBR(cols[iValor] ?? "");
      else {
        const c = numeroBR(cols[iCred] ?? ""), d = numeroBR(cols[iDeb] ?? "");
        valor = c ? Math.abs(c) : d ? -Math.abs(d) : null;
      }
      if (valor !== null && iTipo >= 0 && /^d/i.test(cols[iTipo] ?? "") && valor > 0) valor = -valor;
      descricao = iDesc >= 0 ? cols[iDesc] ?? "" : cols.filter((_, i) => i !== iData && i !== iValor).sort((a, b) => b.length - a.length)[0] ?? "";
      documento = iDoc >= 0 ? cols[iDoc] || null : null;
    } else {
      // sem cabeçalho: a 1ª célula com data, a última com número, a maior com texto
      const iD = cols.findIndex((x) => dataBR(x));
      const nums = cols.map((x, i) => ({ i, n: /\d/.test(x) && !dataBR(x) ? numeroBR(x) : null })).filter((x) => x.n !== null);
      if (iD < 0 || !nums.length) continue;
      data = dataBR(cols[iD]);
      // com saldo na última coluna, o valor costuma ser a penúltima numérica
      valor = (nums.length >= 2 ? nums[nums.length - 2] : nums[0]).n;
      descricao = cols.filter((x) => /[a-zA-Z]/.test(x)).sort((a, b) => b.length - a.length)[0] ?? "";
    }
    if (!data || valor === null || valor === 0) continue;
    if (EH_SALDO.test(descricao)) continue;
    linhas.push({ data, valor: r2(valor), descricao: descricao.trim(), documento });
  }
  return { linhas, saldo_final: null, periodo_de: minData(linhas), periodo_ate: maxData(linhas) };
}

export function minData(l: { data: string }[]): string | null {
  return l.length ? l.reduce((m, x) => (x.data < m ? x.data : m), l[0].data) : null;
}
export function maxData(l: { data: string }[]): string | null {
  return l.length ? l.reduce((m, x) => (x.data > m ? x.data : m), l[0].data) : null;
}

// Descrição sem números/datas/pontuação → chave da regra aprendida
// ("PIX ENVIADO GIGA MAIS FIBRA 24/11" → "pix enviado giga mais fibra")
export function padraoDescricao(s: string): string {
  return sem(String(s ?? ""))
    .replace(/[^a-z ]+/g, " ")
    .replace(/\b[a-z]\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// Chave única por conta: FITID do OFX; senão data|valor|descrição + nº da
// repetição no arquivo (dois PIX iguais no mesmo dia continuam sendo dois).
export function chavesDasLinhas(linhas: LinhaExtrato[]): string[] {
  const vistos = new Map<string, number>();
  return linhas.map((l) => {
    if (l.fitid) return `fit:${l.fitid}|${l.data}|${l.valor.toFixed(2)}`;
    const base = `h:${l.data}|${l.valor.toFixed(2)}|${padraoDescricao(l.descricao)}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return `${base}|${n}`;
  });
}

// Decodifica o arquivo: UTF-8; se vier "quebrado" (banco em Latin-1), Windows-1252.
export function decodificar(buf: ArrayBuffer): string {
  const utf = new TextDecoder("utf-8").decode(buf);
  if (!utf.includes("�")) return utf;
  try { return new TextDecoder("windows-1252").decode(buf); } catch { return utf; }
}

export function detectarFormato(nome: string, txt: string): "ofx" | "csv" {
  if (/\.ofx$/i.test(nome) || /<OFX>|OFXHEADER/i.test(txt.slice(0, 2000))) return "ofx";
  return "csv";
}
