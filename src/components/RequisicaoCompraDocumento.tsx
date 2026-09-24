"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { useEmissora } from "@/lib/useEmissora";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import Badge from "@/components/Badge";
import AtenderRequisicao from "@/components/estoque/AtenderRequisicao";
import { useAcesso, usePode } from "@/components/AcessoProvider";
import { qtdBR } from "@/lib/almox";

type Row = Record<string, any>;
const STATUS = [
  { value: "aberta", label: "Aberta", color: "blue" },
  { value: "atendida_parcial", label: "Atendida em parte", color: "amber" },
  { value: "atendida", label: "Atendida pelo estoque", color: "green" },
  { value: "convertida", label: "Convertida em pedido", color: "green" },
  { value: "cancelada", label: "Cancelada", color: "gray" },
];

export default function RequisicaoCompraDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const EMISSORA = useEmissora();
  const { gerencia } = useAcesso();                   // valores estimados: só gerência
  const podeEstoque = usePode("estoque", "editar");
  const podeCompras = usePode("compras", "editar");
  const [vales, setVales] = useState<Row[]>([]);
  const [destinoNome, setDestinoNome] = useState<string | null>(null);
  const [req, setReq] = useState<Row | null>(null);
  const [itens, setItens] = useState<Row[]>([]);
  const [prodNome, setProdNome] = useState<Record<string, string>>({});
  const [fornecedores, setFornecedores] = useState<Row[]>([]);
  const [depositos, setDepositos] = useState<Row[]>([]);
  const [categorias, setCategorias] = useState<Row[]>([]);
  const [carregando, setCarregando] = useState(true);

  // painel de conversão
  const [fornecedorId, setFornecedorId] = useState("");
  const [depositoId, setDepositoId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [gerando, setGerando] = useState(false);
  const [abrindoCotacao, setAbrindoCotacao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const r = await supabase.from("requisicoes_compra").select("*").eq("id", id).maybeSingle();
    const it = await supabase.from("itens_requisicao_compra").select("*").eq("requisicao_id", id);
    setReq(r.data); setItens(it.data ?? []);
    setVales((await supabase.from("vales_almox").select("id, numero, data, status").eq("requisicao_id", id).order("data")).data ?? []);
    if (r.data?.os_id) { const o = (await supabase.from("ordens_servico").select("numero, titulo").eq("id", r.data.os_id).maybeSingle()).data; setDestinoNome(o ? `🧷 ${[o.numero, o.titulo].filter(Boolean).join(" · ")}` : null); }
    else if (r.data?.obra_id) { const o = (await supabase.from("obras_servicos").select("local").eq("id", r.data.obra_id).maybeSingle()).data; setDestinoNome(o ? `🏗️ ${o.local}` : null); }
    else if (r.data?.centro_custo_id) { const o = (await supabase.from("centros_custo").select("nome").eq("id", r.data.centro_custo_id).maybeSingle()).data; setDestinoNome(o ? `🏷️ ${o.nome}` : null); }
    if (r.data?.fornecedor_sugerido_id) setFornecedorId(r.data.fornecedor_sugerido_id);
    const prods = await supabase.from("produtos").select("id, nome").range(0, 4999);
    setProdNome(Object.fromEntries((prods.data ?? []).map((x: any) => [x.id, x.nome])));
    setFornecedores((await supabase.from("fornecedores").select("id, nome").order("nome")).data ?? []);
    setDepositos((await supabase.from("depositos").select("id, nome").order("nome")).data ?? []);
    setCategorias((await supabase.from("categorias_financeiras").select("id, nome").order("nome")).data ?? []);
    setCarregando(false);
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [supabase, id]);

  async function gerarPedido() {
    setErro(null);
    if (!fornecedorId) { setErro("Escolha o fornecedor para gerar o pedido."); return; }
    setGerando(true);
    const { data, error } = await supabase.rpc("gerar_pedido_de_requisicao", {
      p_requisicao_id: id,
      p_fornecedor_id: fornecedorId,
      p_deposito_id: depositoId || null,
      p_categoria_id: categoriaId || null,
      p_vencimento: vencimento || null,
    });
    setGerando(false);
    if (error) { setErro(error.message); return; }
    router.push(`/compras/pedido/${data}`);
  }

  async function abrirCotacao() {
    setErro(null);
    setAbrindoCotacao(true);
    const { data, error } = await supabase.rpc("gerar_cotacao_de_requisicao", { p_requisicao_id: id });
    setAbrindoCotacao(false);
    if (error) { setErro(error.message); return; }
    router.push(`/compras/cotacao/${data}`);
  }

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!req) return <p className="text-gray-400">Requisição não encontrada. <Link href="/e/requisicoes_compra" className="text-brand-600">voltar</Link></p>;

  const totalEstimado = itens.reduce((s, it) => s + Number(it.quantidade) * Number(it.custo_estimado ?? 0), 0);
  const fornecedorSugerido = fornecedores.find((f) => f.id === req.fornecedor_sugerido_id)?.nome;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/e/requisicoes_compra" className="text-sm text-gray-500 hover:text-gray-800">← voltar</Link>
        <PrintButton />
      </div>

      {/* Atender pelo estoque (almoxarifado) */}
      {podeEstoque && ["aberta", "atendida_parcial"].includes(req.status) && (
        <AtenderRequisicao req={req} itens={itens as any} prodNome={prodNome} onAtendido={carregar} />
      )}

      {/* Painel de conversão — some na impressão */}
      {podeCompras && ["aberta", "atendida_parcial"].includes(req.status) && itens.some((it) => Number(it.quantidade) > Number(it.quantidade_atendida ?? 0)) ? (
        <div className="no-print mb-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-brand-800">
              Comprar o que falta{req.status === "atendida_parcial" ? " (só os itens/quantidades ainda pendentes)" : ""} · cotar preços (opcional)
            </p>
            <button className="btn-ghost text-sm" disabled={abrindoCotacao} onClick={abrirCotacao}>
              {abrindoCotacao ? "Abrindo…" : "💱 Abrir cotação de preços →"}
            </button>
          </div>
          <p className="mb-3 border-t border-brand-100 pt-3 text-sm font-semibold text-brand-800">Ou gerar pedido direto</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-600">Fornecedor *</span>
              <select className="inp w-full" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                <option value="">Selecione…</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
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
          {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-primary" disabled={gerando} onClick={gerarPedido}>
              {gerando ? "Gerando…" : "Gerar pedido de compra →"}
            </button>
            <span className="text-xs text-gray-500">Os preços vão para o pedido (custo estimado como sugestão).</span>
          </div>
        </div>
      ) : req.status === "convertida" && req.pedido_id ? (
        <div className="no-print mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm">
          Requisição já convertida. <Link href={`/compras/pedido/${req.pedido_id}`} className="font-medium text-brand-700 hover:underline">Ver pedido de compra →</Link>
        </div>
      ) : null}

      <div className="doc rounded-xl bg-white p-8 text-gray-800 shadow-sm print:p-0 print:shadow-none">
        <DocHeader titulo="REQUISIÇÃO DE COMPRA" numero={req.numero || "—"} />

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase text-gray-400">Solicitante</p>
            <p className="font-medium">{req.solicitante || "—"}</p>
            {fornecedorSugerido && <p className="mt-1 text-xs text-gray-500">Fornecedor sugerido: {fornecedorSugerido}</p>}
            {destinoNome && <p className="mt-1 text-xs text-gray-500">Destino: {destinoNome}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
            <Campo rot="Data" val={formatDate(req.data)} />
            <div><p className="text-[11px] uppercase text-gray-400">Status</p><Badge value={req.status} options={STATUS} /></div>
          </div>
        </div>

        <table className="mt-6 min-w-full text-sm">
          <thead className="border-b text-left text-xs uppercase text-gray-500">
            <tr><th className="py-2 pr-2">Produto</th><th className="py-2 pr-2 text-right">Qtd</th><th className="py-2 pr-2 text-right">Entregue</th>
              {gerencia && <><th className="py-2 pr-2 text-right">Custo est.</th><th className="py-2 text-right">Subtotal est.</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itens.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center text-gray-400">Sem itens.</td></tr>
            ) : itens.map((it) => (
              <tr key={it.id}>
                <td className="py-2 pr-2">{prodNome[it.produto_id] ?? "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{qtdBR(it.quantidade)}</td>
                <td className={`py-2 pr-2 text-right tabular-nums ${Number(it.quantidade_atendida ?? 0) >= Number(it.quantidade) ? "text-green-700" : Number(it.quantidade_atendida ?? 0) > 0 ? "text-amber-700" : "text-gray-400"}`}>
                  {qtdBR(it.quantidade_atendida ?? 0)}
                </td>
                {gerencia && <>
                  <td className="py-2 pr-2 text-right tabular-nums">{it.custo_estimado != null ? formatCurrency(it.custo_estimado) : "—"}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{it.custo_estimado != null ? formatCurrency(Number(it.quantidade) * Number(it.custo_estimado)) : "—"}</td>
                </>}
              </tr>
            ))}
          </tbody>
          {gerencia && totalEstimado > 0 && (
            <tfoot className="border-t-2 border-brand-600 font-semibold">
              <tr><td colSpan={4} className="py-2 pr-2 text-right">TOTAL ESTIMADO</td><td className="py-2 text-right text-brand-700">{formatCurrency(totalEstimado)}</td></tr>
            </tfoot>
          )}
        </table>

        {req.observacao && <p className="mt-4 text-sm text-gray-600"><b>Observação:</b> {req.observacao}</p>}
        {vales.length > 0 && (
          <p className="mt-2 text-sm text-gray-600">
            <b>Entregue pelo almoxarifado:</b>{" "}
            {vales.map((v, i) => (
              <span key={v.id}>{i > 0 && ", "}<Link href={`/estoque/vale/${v.id}`} className={`text-brand-700 hover:underline ${v.status === "cancelado" ? "line-through" : ""}`}>{v.numero}</Link> ({formatDate(v.data)})</span>
            ))}
          </p>
        )}

        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div className="border-t border-gray-400 pt-2 text-center"><p className="font-medium">{req.solicitante || "Solicitante"}</p><p className="text-xs text-gray-500">Solicitante</p></div>
          <div className="border-t border-gray-400 pt-2 text-center"><p className="font-medium">{EMISSORA.nome}</p><p className="text-xs text-gray-500">Aprovação / Compras</p></div>
        </div>

        <div className="mt-8 border-t pt-3 text-center text-xs text-gray-400">
          {EMISSORA.nome} · CNPJ {EMISSORA.cnpj} · Requisição Nº {req.numero || "—"} · {EMISSORA.sistema}
        </div>
      </div>
    </div>
  );
}

function Campo({ rot, val }: { rot: string; val: any }) {
  return <div><p className="text-[11px] uppercase text-gray-400">{rot}</p><p className="font-medium text-gray-800">{val || "—"}</p></div>;
}
