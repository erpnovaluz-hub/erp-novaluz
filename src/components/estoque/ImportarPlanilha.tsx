"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { adivinharColuna, lerColado, normalizar, numeroBR } from "@/lib/planilha";

export type ProdutoBase = { id: string; codigo: string | null; nome: string; unidade: string | null; secao: string | null };

const SECOES = ["epis", "eletricos", "metalicos", "ferramentas", "consumiveis", "hidraulico", "outros"];
function secaoDe(txt: string): string {
  const t = normalizar(txt);
  if (!t) return "outros";
  if (/epi/.test(t)) return "epis";
  if (/eletr/.test(t)) return "eletricos";
  if (/metal|aco|chapa|perfil|tubo/.test(t)) return "metalicos";
  if (/ferram/.test(t)) return "ferramentas";
  if (/consum/.test(t)) return "consumiveis";
  if (/hidra/.test(t)) return "hidraulico";
  return SECOES.includes(t) ? t : "outros";
}

type Campo = "codigo" | "nome" | "quantidade" | "custo" | "unidade" | "secao";
const CAMPOS: { key: Campo; label: string; padroes: RegExp[] }[] = [
  { key: "codigo", label: "Código", padroes: [/^cod/, /codigo|ref|sku/] },
  { key: "nome", label: "Produto / descrição", padroes: [/^(produto|item|material|nome|descricao)/, /descri|produto|nome|material/] },
  { key: "quantidade", label: "Quantidade", padroes: [/^(qtd|quant|saldo|estoque|contad)/, /qtd|quant|saldo|contad/] },
  { key: "custo", label: "Custo unitário", padroes: [/custo|valor unit|preco unit|vl unit/, /custo|valor|preco/] },
  { key: "unidade", label: "Unidade", padroes: [/^(un|und|unid|unidade)$/, /^unid/] },
  { key: "secao", label: "Seção / categoria", padroes: [/secao|categoria|grupo|familia/] },
];

// Cola da planilha → casa com os produtos (código, senão nome) → grava itens do inventário.
export default function ImportarPlanilha({ inventarioId, produtos, verCusto, onFechar, onImportado }: {
  inventarioId: string; produtos: ProdutoBase[]; verCusto: boolean;
  onFechar: () => void; onImportado: (msg: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [texto, setTexto] = useState("");
  const [temCab, setTemCab] = useState(true);
  const [mapa, setMapa] = useState<Record<Campo, number> | null>(null);
  const [criarNovos, setCriarNovos] = useState(true);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const tab = useMemo(() => lerColado(texto, temCab), [texto, temCab]);

  // mapeamento automático ao colar (o usuário pode trocar)
  const col = useMemo(() => {
    if (mapa) return mapa;
    const m = {} as Record<Campo, number>;
    for (const c of CAMPOS) m[c.key] = temCab ? adivinharColuna(tab.cabecalho, c.padroes) : -1;
    if (!temCab && tab.cabecalho.length >= 2) { m.nome = 0; m.quantidade = 1; }
    return m;
  }, [mapa, tab, temCab]);

  const porCodigo = useMemo(() => new Map(produtos.filter((p) => p.codigo).map((p) => [normalizar(p.codigo), p])), [produtos]);
  const porNome = useMemo(() => new Map(produtos.map((p) => [normalizar(p.nome), p])), [produtos]);

  // linhas interpretadas (repetidas do mesmo produto somam: contado em 2 lugares)
  const linhas = useMemo(() => tab.linhas.map((l, i) => {
    const v = (k: Campo) => (col[k] >= 0 ? l[col[k]] ?? "" : "");
    const codigo = v("codigo"), nome = v("nome");
    const qtd = numeroBR(v("quantidade"));
    const custo = verCusto && col.custo >= 0 ? numeroBR(v("custo")) : null;
    const achado = (codigo && porCodigo.get(normalizar(codigo))) || (nome && porNome.get(normalizar(nome))) || null;
    const problema = !codigo && !nome ? "sem produto" : qtd == null || Number.isNaN(qtd) || qtd < 0 ? "quantidade inválida"
      : custo != null && Number.isNaN(custo) ? "custo inválido" : !achado && !nome ? "código não encontrado" : null;
    return { i, codigo, nome, qtd, custo, unidade: v("unidade"), secao: v("secao"), achado, problema };
  }), [tab, col, porCodigo, porNome, verCusto]);

  const validas = linhas.filter((l) => !l.problema && (l.achado || criarNovos));
  const novas = linhas.filter((l) => !l.problema && !l.achado);

  async function importar() {
    setGravando(true); setErro(null);
    try {
      // 1) cadastra os produtos que não existem
      const criados = new Map<string, string>();
      if (criarNovos && novas.length) {
        const unicos = Array.from(new Map(novas.map((l) => [normalizar(l.nome), l])).values());
        for (let k = 0; k < unicos.length; k += 200) {
          const lote = unicos.slice(k, k + 200).map((l) => ({
            nome: l.nome.trim(), codigo: l.codigo || null, unidade: l.unidade || "un",
            secao: secaoDe(l.secao), tipo: "insumo", ativo: true,
          }));
          const { data, error } = await supabase.from("produtos").insert(lote).select("id, nome");
          if (error) throw error;
          for (const p of data ?? []) criados.set(normalizar(p.nome), p.id);
        }
      }
      // 2) soma repetidos e grava os itens
      const itens = new Map<string, { quantidade_contada: number; custo_unitario: number | null }>();
      for (const l of validas) {
        const id = l.achado?.id ?? criados.get(normalizar(l.nome));
        if (!id) continue;
        const atual = itens.get(id);
        itens.set(id, {
          quantidade_contada: (atual?.quantidade_contada ?? 0) + (l.qtd ?? 0),
          custo_unitario: l.custo ?? atual?.custo_unitario ?? null,
        });
      }
      const registros = Array.from(itens.entries()).map(([produto_id, x]) => ({
        inventario_id: inventarioId, produto_id, quantidade_contada: x.quantidade_contada,
        ...(verCusto ? { custo_unitario: x.custo_unitario } : {}),
        atualizado_em: new Date().toISOString(),
      }));
      for (let k = 0; k < registros.length; k += 500) {
        const { error } = await supabase.from("inventario_itens").upsert(registros.slice(k, k + 500), { onConflict: "inventario_id,produto_id" });
        if (error) throw error;
      }
      onImportado(`${registros.length} item(ns) importado(s)${criados.size ? ` · ${criados.size} produto(s) novo(s) cadastrado(s)` : ""}.`);
    } catch (e: any) {
      setErro(e.message ?? String(e));
    } finally {
      setGravando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onFechar}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-gray-900">📥 Colar da planilha</h2>
          <button className="btn-ghost text-lg leading-none" onClick={onFechar} aria-label="Fechar">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div>
            <p className="mb-1 text-gray-600">No Excel, selecione as colunas (com o cabeçalho), copie (Ctrl+C) e cole aqui (Ctrl+V):</p>
            <textarea className="inp min-h-[120px] w-full font-mono text-xs" placeholder={"Código\tProduto\tUnidade\tQuantidade" + (verCusto ? "\tCusto" : "") + "\nEPI-001\tLuva de vaqueta\tpar\t40" + (verCusto ? "\t12,50" : "")}
              value={texto} onChange={(e) => { setTexto(e.target.value); setMapa(null); }} />
            <label className="mt-1 flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={temCab} onChange={(e) => { setTemCab(e.target.checked); setMapa(null); }} /> A primeira linha é o cabeçalho
            </label>
          </div>

          {tab.linhas.length > 0 && (
            <>
              <div>
                <p className="mb-1 font-medium text-gray-700">Qual coluna é qual?</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CAMPOS.filter((c) => c.key !== "custo" || verCusto).map((c) => (
                    <label key={c.key} className="block">
                      <span className="text-xs text-gray-500">{c.label}{(c.key === "quantidade") && " *"}</span>
                      <select className="inp py-1" value={col[c.key]} onChange={(e) => setMapa({ ...col, [c.key]: Number(e.target.value) })}>
                        <option value={-1}>— não usar —</option>
                        {tab.cabecalho.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-400">O produto é encontrado pelo código; se não tiver código, pelo nome (sem diferenciar acento e maiúscula).</p>
              </div>

              <div className="flex flex-wrap gap-3 text-xs">
                <span className="rounded bg-green-50 px-2 py-1 text-green-700">✓ {linhas.filter((l) => l.achado && !l.problema).length} encontrado(s)</span>
                <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">＋ {novas.length} novo(s)</span>
                {linhas.some((l) => l.problema) && <span className="rounded bg-red-50 px-2 py-1 text-red-700">⚠ {linhas.filter((l) => l.problema).length} com problema (ignoradas)</span>}
              </div>
              {novas.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={criarNovos} onChange={(e) => setCriarNovos(e.target.checked)} />
                  Cadastrar os {novas.length} produto(s) novo(s) automaticamente
                </label>
              )}

              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 text-left text-gray-500">
                    <tr><th className="px-2 py-1.5"></th><th className="px-2 py-1.5">Código</th><th className="px-2 py-1.5">Produto</th><th className="px-2 py-1.5 text-right">Qtd</th>{verCusto && <th className="px-2 py-1.5 text-right">Custo</th>}<th className="px-2 py-1.5">Situação</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {linhas.slice(0, 200).map((l) => (
                      <tr key={l.i} className={l.problema ? "bg-red-50/60" : ""}>
                        <td className="px-2 py-1 text-gray-400">{l.i + 1}</td>
                        <td className="px-2 py-1">{l.codigo || "—"}</td>
                        <td className="px-2 py-1">{l.achado?.nome ?? l.nome ?? "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{l.qtd == null || Number.isNaN(l.qtd) ? "?" : l.qtd.toLocaleString("pt-BR")}</td>
                        {verCusto && <td className="px-2 py-1 text-right tabular-nums">{l.custo == null ? "" : Number.isNaN(l.custo) ? "?" : l.custo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>}
                        <td className="px-2 py-1">
                          {l.problema ? <span className="text-red-600">⚠ {l.problema}</span>
                            : l.achado ? <span className="text-green-700">✓ encontrado</span>
                            : <span className="text-blue-700">{criarNovos ? "＋ será cadastrado" : "ignorado (novo)"}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {linhas.length > 200 && <p className="px-2 py-1 text-xs text-gray-400">… e mais {linhas.length - 200} linha(s)</p>}
              </div>
            </>
          )}
          {erro && <div className="rounded-lg bg-red-50 p-3 text-red-700">{erro}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn-primary" disabled={gravando || validas.length === 0 || col.quantidade < 0} onClick={importar}>
            {gravando ? "Importando…" : `Importar ${validas.length} linha(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
