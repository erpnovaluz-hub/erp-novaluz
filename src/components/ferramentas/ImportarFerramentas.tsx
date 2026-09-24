"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { adivinharColuna, lerColado, normalizar, numeroBR } from "@/lib/planilha";
import { catLabel } from "@/lib/ferramentas";

type Campo = "codigo" | "descricao" | "quantidade" | "categoria" | "marca" | "modelo" | "numero_serie" | "valor" | "data" | "estado";
const CAMPOS: { key: Campo; label: string; padroes: RegExp[] }[] = [
  { key: "codigo", label: "Código / patrimônio", padroes: [/^(cod|patrim|tag|etiqueta)/] },
  { key: "descricao", label: "Descrição *", padroes: [/^(descri|ferrament|equipament|item|nome|produto)/, /descri|ferrament|equipament|nome/] },
  { key: "quantidade", label: "Quantidade (unidades)", padroes: [/^(qtd|quant)/] },
  { key: "categoria", label: "Categoria / tipo", padroes: [/categ|tipo|grupo|familia/] },
  { key: "marca", label: "Marca", padroes: [/^marca|fabricante/] },
  { key: "modelo", label: "Modelo", padroes: [/^modelo/] },
  { key: "numero_serie", label: "Nº de série", padroes: [/seri|^ns$|^n\.? ?s/] },
  { key: "valor", label: "Valor", padroes: [/valor|preco|custo/] },
  { key: "data", label: "Data de aquisição", padroes: [/data|aquisi|compra/] },
  { key: "estado", label: "Estado / conservação", padroes: [/estado|conserv|condic/] },
];

function categoriaDe(t: string): string {
  const x = normalizar(t);
  if (/eletr|bateria|furadeira|esmeril|lixadeira|parafusadeira|serra/.test(x)) return "ferramenta_eletrica";
  if (/medi|trena|paquimetro|nivel|calibr|multimetro/.test(x)) return "instrumento_medicao";
  if (/epi|cinto|capacete|mascara/.test(x)) return "epi_duravel";
  if (/veic|carro|caminh|moto/.test(x)) return "veiculo";
  if (/equip|maquina|gerador|compressor|solda|andaime|talha|macaco/.test(x)) return "equipamento";
  if (/manual|chave|alicate|martelo|marreta/.test(x)) return "ferramenta_manual";
  return x ? "outro" : "";
}
function estadoDe(t: string): string {
  const x = normalizar(t);
  if (/nov/.test(x)) return "novo";
  if (/ruim|pessim|danif/.test(x)) return "ruim";
  if (/regul|medio|usad/.test(x)) return "regular";
  return "bom";
}
function dataDe(t: string): string | null {
  const s = t.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export default function ImportarFerramentas({ onFechar, onImportado }: { onFechar: () => void; onImportado: (msg: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { gerencia } = useAcesso();
  const [texto, setTexto] = useState("");
  const [mapa, setMapa] = useState<Record<Campo, number> | null>(null);
  const [depositos, setDepositos] = useState<{ id: string; nome: string }[]>([]);
  const [deposito, setDeposito] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome").then(({ data }) => {
      setDepositos(data ?? []); setDeposito((d) => d || data?.[0]?.id || "");
    });
  }, [supabase]);

  const tab = useMemo(() => lerColado(texto, true), [texto]);
  const col = useMemo(() => {
    if (mapa) return mapa;
    const m = {} as Record<Campo, number>;
    for (const c of CAMPOS) m[c.key] = adivinharColuna(tab.cabecalho, c.padroes);
    return m;
  }, [mapa, tab]);

  const linhas = useMemo(() => tab.linhas.map((l, i) => {
    const v = (k: Campo) => (col[k] >= 0 ? (l[col[k]] ?? "").trim() : "");
    const qtdBruta = col.quantidade >= 0 ? numeroBR(v("quantidade")) : 1;
    const qtd = qtdBruta == null ? 1 : qtdBruta;
    const descricao = v("descricao");
    const problema = !descricao ? "sem descrição"
      : Number.isNaN(qtd) || qtd < 1 || qtd !== Math.trunc(qtd) ? "quantidade inválida"
      : qtd > 1 && v("codigo") ? "código com qtd > 1 (use 1 linha por unidade)" : null;
    return {
      i, descricao, qtd: Number.isNaN(qtd) ? 0 : qtd, codigo: v("codigo"),
      categoria: categoriaDe(v("categoria")) || categoriaDe(descricao) || "outro",
      marca: v("marca"), modelo: v("modelo"), numero_serie: v("numero_serie"),
      valor: gerencia && col.valor >= 0 ? numeroBR(v("valor")) : null, data: dataDe(v("data")), estado: estadoDe(v("estado")),
      problema,
    };
  }), [tab, col, gerencia]);

  const validas = linhas.filter((l) => !l.problema);
  const unidades = validas.reduce((s, l) => s + l.qtd, 0);

  async function importar() {
    setGravando(true); setErro(null);
    try {
      const regs: Record<string, any>[] = [];
      for (const l of validas) for (let k = 0; k < l.qtd; k++) regs.push({
        codigo: l.codigo || null, descricao: l.descricao, categoria: l.categoria, marca: l.marca || null, modelo: l.modelo || null,
        numero_serie: l.numero_serie || null, data_aquisicao: l.data, estado: l.estado, deposito_id: deposito || null,
        ...(gerencia && l.valor != null && !Number.isNaN(l.valor) ? { valor_aquisicao: l.valor } : {}),
      });
      for (let k = 0; k < regs.length; k += 200) {
        const { error } = await supabase.from("ferramentas").insert(regs.slice(k, k + 200));
        if (error) throw new Error(error.message.includes("duplicate") ? `Código repetido (já cadastrado ou duplicado na planilha) — lote a partir da linha ${k + 1}.` : error.message);
      }
      onImportado(`${regs.length} ferramenta(s) cadastrada(s). Imprima as etiquetas na lista.`);
    } catch (e: any) {
      setErro(e.message ?? String(e));
    } finally { setGravando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onFechar}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">📥 Importar ferramentas da planilha</h2>
          <button className="text-2xl leading-none text-gray-400" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-gray-600">Copie as colunas da planilha <b>com o cabeçalho</b> e cole aqui. Uma linha por ferramenta — ou use a coluna Quantidade para cadastrar várias unidades iguais (cada uma ganha seu código).</p>
          <textarea className="inp min-h-[110px] w-full font-mono text-xs" value={texto} onChange={(e) => { setTexto(e.target.value); setMapa(null); }}
            placeholder={"Descrição\tMarca\tModelo\tNº série\tQtd\nEsmerilhadeira 7\"\tBosch\tGWS 22-180\t\t3"} />
          {tab.linhas.length > 0 && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CAMPOS.filter((c) => c.key !== "valor" || gerencia).map((c) => (
                  <label key={c.key} className="block">
                    <span className="text-xs text-gray-500">{c.label}</span>
                    <select className="inp py-1" value={col[c.key]} onChange={(e) => setMapa({ ...col, [c.key]: Number(e.target.value) })}>
                      <option value={-1}>— não usar —</option>
                      {tab.cabecalho.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
                <label className="block"><span className="text-xs text-gray-500">Guardar no depósito</span>
                  <select className="inp py-1" value={deposito} onChange={(e) => setDeposito(e.target.value)}>
                    {depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 text-left text-gray-500">
                    <tr><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Código</th><th className="px-2 py-1.5">Descrição</th><th className="px-2 py-1.5">Categoria</th><th className="px-2 py-1.5">Marca/modelo</th><th className="px-2 py-1.5 text-right">Un.</th><th className="px-2 py-1.5">Situação</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {linhas.slice(0, 200).map((l) => (
                      <tr key={l.i} className={l.problema ? "bg-red-50/60" : ""}>
                        <td className="px-2 py-1 text-gray-400">{l.i + 1}</td>
                        <td className="px-2 py-1">{l.codigo || <span className="text-gray-400">auto</span>}</td>
                        <td className="px-2 py-1">{l.descricao || "—"}</td>
                        <td className="px-2 py-1">{catLabel(l.categoria)}</td>
                        <td className="px-2 py-1">{[l.marca, l.modelo].filter(Boolean).join(" ") || "—"}</td>
                        <td className="px-2 py-1 text-right">{l.qtd}</td>
                        <td className="px-2 py-1">{l.problema ? <span className="text-red-600">⚠ {l.problema}</span> : <span className="text-green-700">✓</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {erro && <div className="rounded-lg bg-red-50 p-3 text-red-700">{erro}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn-primary" disabled={gravando || unidades === 0 || col.descricao < 0} onClick={importar}>
            {gravando ? "Importando…" : `Cadastrar ${unidades} unidade(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
