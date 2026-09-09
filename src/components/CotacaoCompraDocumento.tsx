"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { useEmissora } from "@/lib/useEmissora";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import Badge from "@/components/Badge";

type Row = Record<string, any>;
const STATUS = [
  { value: "aberta", label: "Aberta", color: "blue" },
  { value: "decidida", label: "Decidida (gerou pedido)", color: "green" },
  { value: "cancelada", label: "Cancelada", color: "gray" },
];
const chave = (produto: string, fornecedor: string) => `${produto}|${fornecedor}`;

export default function CotacaoCompraDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const EMISSORA = useEmissora();

  const [cot, setCot] = useState<Row | null>(null);
  const [itens, setItens] = useState<Row[]>([]);
  const [participantes, setParticipantes] = useState<Row[]>([]); // cotacao_fornecedores
  const [precos, setPrecos] = useState<Record<string, string>>({}); // chave -> preço (string p/ input)
  const [prodNome, setProdNome] = useState<Record<string, string>>({});
  const [fornNome, setFornNome] = useState<Record<string, string>>({});
  const [fornecedores, setFornecedores] = useState<Row[]>([]);
  const [depositos, setDepositos] = useState<Row[]>([]);
  const [categorias, setCategorias] = useState<Row[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // mini-forms
  const [novoProduto, setNovoProduto] = useState("");
  const [novaQtd, setNovaQtd] = useState("");
  const [novoFornecedor, setNovoFornecedor] = useState("");

  // painel de decisão
  const [vencedorId, setVencedorId] = useState("");
  const [depositoId, setDepositoId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [gerando, setGerando] = useState(false);

  const carregar = useCallback(async () => {
    const c = await supabase.from("cotacoes_compra").select("*").eq("id", id).maybeSingle();
    const it = await supabase.from("itens_cotacao").select("*").eq("cotacao_id", id);
    const pf = await supabase.from("cotacao_fornecedores").select("*").eq("cotacao_id", id);
    const pr = await supabase.from("cotacao_precos").select("*").eq("cotacao_id", id);
    setCot(c.data); setItens(it.data ?? []); setParticipantes(pf.data ?? []);
    const mapPr: Record<string, string> = {};
    for (const p of (pr.data ?? []) as Row[]) mapPr[chave(p.produto_id, p.fornecedor_id)] = String(p.preco_unitario);
    setPrecos(mapPr);
    const prods = await supabase.from("produtos").select("id, nome").range(0, 4999);
    setProdNome(Object.fromEntries((prods.data ?? []).map((x: any) => [x.id, x.nome])));
    const forns = (await supabase.from("fornecedores").select("id, nome").order("nome")).data ?? [];
    setFornecedores(forns);
    setFornNome(Object.fromEntries(forns.map((x: any) => [x.id, x.nome])));
    setDepositos((await supabase.from("depositos").select("id, nome").order("nome")).data ?? []);
    setCategorias((await supabase.from("categorias_financeiras").select("id, nome").order("nome")).data ?? []);
    setCarregando(false);
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  const editavel = cot?.status === "aberta";

  async function addItem() {
    if (!novoProduto || !novaQtd) return;
    const { error } = await supabase.from("itens_cotacao").insert({ cotacao_id: id, produto_id: novoProduto, quantidade: Number(novaQtd) });
    if (error) return setErro(error.message);
    setNovoProduto(""); setNovaQtd(""); carregar();
  }
  async function removerItem(itemId: string) {
    if (!confirm("Remover este item da cotação?")) return;
    await supabase.from("itens_cotacao").delete().eq("id", itemId);
    carregar();
  }
  async function addFornecedor() {
    if (!novoFornecedor) return;
    const { error } = await supabase.from("cotacao_fornecedores").insert({ cotacao_id: id, fornecedor_id: novoFornecedor });
    if (error) return setErro(error.message);
    setNovoFornecedor(""); carregar();
  }
  async function removerFornecedor(fornecedorId: string) {
    if (!confirm("Remover este fornecedor da cotação? Os preços dele serão apagados.")) return;
    await supabase.from("cotacao_precos").delete().eq("cotacao_id", id).eq("fornecedor_id", fornecedorId);
    await supabase.from("cotacao_fornecedores").delete().eq("cotacao_id", id).eq("fornecedor_id", fornecedorId);
    carregar();
  }

  async function salvarPreco(produtoId: string, fornecedorId: string, valor: string) {
    const k = chave(produtoId, fornecedorId);
    const v = valor.trim();
    if (v === "") {
      await supabase.from("cotacao_precos").delete().eq("cotacao_id", id).eq("produto_id", produtoId).eq("fornecedor_id", fornecedorId);
      setPrecos((p) => { const n = { ...p }; delete n[k]; return n; });
      return;
    }
    const num = Number(v);
    if (isNaN(num) || num < 0) return;
    const { error } = await supabase.from("cotacao_precos").upsert(
      { cotacao_id: id, produto_id: produtoId, fornecedor_id: fornecedorId, preco_unitario: num },
      { onConflict: "cotacao_id,produto_id,fornecedor_id" }
    );
    if (error) setErro(error.message);
  }

  function totalFornecedor(fornecedorId: string) {
    return itens.reduce((s, it) => {
      const p = Number(precos[chave(it.produto_id, fornecedorId)] ?? 0);
      return s + Number(it.quantidade) * p;
    }, 0);
  }

  async function gerarPedido() {
    setErro(null);
    if (!vencedorId) { setErro("Escolha o fornecedor vencedor."); return; }
    setGerando(true);
    const { data, error } = await supabase.rpc("gerar_pedido_de_cotacao", {
      p_cotacao_id: id, p_fornecedor_id: vencedorId,
      p_deposito_id: depositoId || null, p_categoria_id: categoriaId || null, p_vencimento: vencimento || null,
    });
    setGerando(false);
    if (error) { setErro(error.message); return; }
    router.push(`/compras/pedido/${data}`);
  }

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!cot) return <p className="text-gray-400">Cotação não encontrada. <Link href="/e/cotacoes_compra" className="text-brand-600">voltar</Link></p>;

  // fornecedor mais barato (só entre os que têm algum preço lançado)
  const totais = participantes.map((pf) => ({ id: pf.fornecedor_id, total: totalFornecedor(pf.fornecedor_id) }));
  const comPreco = totais.filter((t) => t.total > 0);
  const menorTotal = comPreco.length ? Math.min(...comPreco.map((t) => t.total)) : null;
  const maisBaratoId = menorTotal != null ? comPreco.find((t) => t.total === menorTotal)?.id : null;
  const fornDisponiveis = fornecedores.filter((f) => !participantes.some((p) => p.fornecedor_id === f.id));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/e/cotacoes_compra" className="text-sm text-gray-500 hover:text-gray-800">← voltar</Link>
        <PrintButton />
      </div>

      {erro && <div className="no-print mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {cot.status === "decidida" && cot.pedido_id && (
        <div className="no-print mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm">
          Cotação decidida — vencedor: <b>{fornNome[cot.fornecedor_vencedor_id] ?? "—"}</b>.{" "}
          <Link href={`/compras/pedido/${cot.pedido_id}`} className="font-medium text-brand-700 hover:underline">Ver pedido de compra →</Link>
        </div>
      )}

      <div className="doc rounded-xl bg-white p-8 text-gray-800 shadow-sm print:p-0 print:shadow-none">
        <DocHeader titulo="COTAÇÃO DE PREÇOS" numero={cot.numero || "—"} />

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <Campo rot="Data" val={formatDate(cot.data)} />
          <div><p className="text-[11px] uppercase text-gray-400">Status</p><Badge value={cot.status} options={STATUS} /></div>
        </div>

        {/* controles de itens/fornecedores — somem na impressão */}
        {editavel && (
          <div className="no-print mt-5 grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
            <div className="flex items-end gap-2">
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-600">Adicionar item</span>
                <select className="inp w-full" value={novoProduto} onChange={(e) => setNovoProduto(e.target.value)}>
                  <option value="">Produto…</option>
                  {Object.entries(prodNome).map(([pid, nome]) => <option key={pid} value={pid}>{nome}</option>)}
                </select>
              </label>
              <input className="inp w-24" type="number" step="any" placeholder="Qtd" value={novaQtd} onChange={(e) => setNovaQtd(e.target.value)} />
              <button className="btn-ghost" onClick={addItem}>+ item</button>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-600">Adicionar fornecedor</span>
                <select className="inp w-full" value={novoFornecedor} onChange={(e) => setNovoFornecedor(e.target.value)}>
                  <option value="">Fornecedor…</option>
                  {fornDisponiveis.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </label>
              <button className="btn-ghost" onClick={addFornecedor}>+ fornecedor</button>
            </div>
          </div>
        )}

        {/* matriz itens × fornecedores */}
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="py-2 pr-3">Produto</th>
                <th className="py-2 pr-3 text-right">Qtd</th>
                {participantes.map((pf) => (
                  <th key={pf.id} className={`py-2 pr-3 text-right ${pf.fornecedor_id === maisBaratoId ? "text-green-700" : ""}`}>
                    <div className="flex items-center justify-end gap-1">
                      <span>{fornNome[pf.fornecedor_id] ?? "—"}</span>
                      {editavel && <button className="no-print text-red-400 hover:text-red-600" title="remover" onClick={() => removerFornecedor(pf.fornecedor_id)}>✕</button>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itens.length === 0 ? (
                <tr><td colSpan={2 + participantes.length} className="py-4 text-center text-gray-400">Sem itens. Adicione acima.</td></tr>
              ) : itens.map((it) => (
                <tr key={it.id}>
                  <td className="py-2 pr-3">
                    {editavel && <button className="no-print mr-1 text-red-400 hover:text-red-600" title="remover item" onClick={() => removerItem(it.id)}>✕</button>}
                    {prodNome[it.produto_id] ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{Number(it.quantidade)}</td>
                  {participantes.map((pf) => {
                    const k = chave(it.produto_id, pf.fornecedor_id);
                    return (
                      <td key={pf.id} className="py-1 pr-3 text-right">
                        {editavel ? (
                          <input
                            className="inp w-24 text-right"
                            type="number" step="0.01" placeholder="—"
                            value={precos[k] ?? ""}
                            onChange={(e) => setPrecos((p) => ({ ...p, [k]: e.target.value }))}
                            onBlur={(e) => salvarPreco(it.produto_id, pf.fornecedor_id, e.target.value)}
                          />
                        ) : (
                          <span className="tabular-nums">{precos[k] ? formatCurrency(Number(precos[k])) : "—"}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {participantes.length > 0 && itens.length > 0 && (
              <tfoot className="border-t-2 border-brand-600 font-semibold">
                <tr>
                  <td className="py-2 pr-3 text-right" colSpan={2}>TOTAL</td>
                  {participantes.map((pf) => {
                    const t = totalFornecedor(pf.fornecedor_id);
                    return (
                      <td key={pf.id} className={`py-2 pr-3 text-right tabular-nums ${pf.fornecedor_id === maisBaratoId ? "text-green-700" : "text-brand-700"}`}>
                        {formatCurrency(t)}{pf.fornecedor_id === maisBaratoId && <span className="ml-1 text-[10px] uppercase">✓ menor</span>}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {cot.observacao && <p className="mt-4 text-sm text-gray-600"><b>Observação:</b> {cot.observacao}</p>}

        <div className="mt-8 border-t pt-3 text-center text-xs text-gray-400">
          {EMISSORA.nome} · CNPJ {EMISSORA.cnpj} · Cotação Nº {cot.numero || "—"} · {EMISSORA.sistema}
        </div>
      </div>

      {/* painel de decisão */}
      {editavel && participantes.length > 0 && itens.length > 0 && (
        <div className="no-print mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="mb-3 text-sm font-semibold text-brand-800">Definir vencedor e gerar pedido</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Fornecedor vencedor *</span>
              <select className="inp w-full" value={vencedorId} onChange={(e) => setVencedorId(e.target.value)}>
                <option value="">Selecione…</option>
                {participantes.map((pf) => (
                  <option key={pf.id} value={pf.fornecedor_id}>
                    {fornNome[pf.fornecedor_id] ?? "—"} — {formatCurrency(totalFornecedor(pf.fornecedor_id))}{pf.fornecedor_id === maisBaratoId ? " (menor)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Depósito de destino</span>
              <select className="inp w-full" value={depositoId} onChange={(e) => setDepositoId(e.target.value)}>
                <option value="">—</option>
                {depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Categoria (a pagar)</span>
              <select className="inp w-full" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">—</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Vencimento (a pagar)</span>
              <input type="date" className="inp w-full" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-primary" disabled={gerando} onClick={gerarPedido}>
              {gerando ? "Gerando…" : "Gerar pedido de compra →"}
            </button>
            {maisBaratoId && !vencedorId && (
              <button type="button" className="btn-ghost text-xs" onClick={() => setVencedorId(maisBaratoId)}>usar o mais barato</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Campo({ rot, val }: { rot: string; val: any }) {
  return <div><p className="text-[11px] uppercase text-gray-400">{rot}</p><p className="font-medium text-gray-800">{val || "—"}</p></div>;
}
