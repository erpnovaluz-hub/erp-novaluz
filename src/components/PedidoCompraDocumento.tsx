"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { useEmissora } from "@/lib/useEmissora";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import Badge from "@/components/Badge";
import WhatsAppButton from "@/components/WhatsAppButton";
import ReceberPedido from "@/components/estoque/ReceberPedido";
import { useAcesso, usePode } from "@/components/AcessoProvider";
import { qtdBR } from "@/lib/almox";

type Row = Record<string, any>;
const STATUS = [
  { value: "aberto", label: "Aberto", color: "blue" },
  { value: "parcial", label: "Recebido em parte", color: "amber" },
  { value: "recebido", label: "Recebido", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];

export default function PedidoCompraDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const EMISSORA = useEmissora();
  const { gerencia } = useAcesso();                 // preços: só gerência
  const podeCompras = usePode("compras", "editar");
  const podeEstoque = usePode("estoque", "editar");
  const podeReceber = podeCompras || podeEstoque;
  const [recebimentos, setRecebimentos] = useState<Row[]>([]);
  const [recItens, setRecItens] = useState<Row[]>([]);
  const [prodUn, setProdUn] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [ped, setPed] = useState<Row | null>(null);
  const [itens, setItens] = useState<Row[]>([]);
  const [fornecedor, setFornecedor] = useState<Row | null>(null);
  const [deposito, setDeposito] = useState<Row | null>(null);
  const [prodNome, setProdNome] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const p = await supabase.from("pedidos_compra").select("*").eq("id", id).maybeSingle();
    const it = await supabase.from("itens_pedido_compra").select("*").eq("pedido_id", id);
    setPed(p.data); setItens(it.data ?? []);
    if (p.data?.fornecedor_id) setFornecedor((await supabase.from("fornecedores").select("*").eq("id", p.data.fornecedor_id).maybeSingle()).data);
    if (p.data?.deposito_id) setDeposito((await supabase.from("depositos").select("nome").eq("id", p.data.deposito_id).maybeSingle()).data);
    const prods = await supabase.from("produtos").select("id, nome, unidade").range(0, 19999);
    setProdNome(Object.fromEntries((prods.data ?? []).map((x: any) => [x.id, x.nome])));
    setProdUn(Object.fromEntries((prods.data ?? []).map((x: any) => [x.id, x.unidade ?? ""])));
    const rec = await supabase.from("recebimentos_compra").select("*").eq("pedido_id", id).order("criado_em");
    setRecebimentos(rec.data ?? []);
    const ids = (rec.data ?? []).map((r: any) => r.id);
    setRecItens(ids.length ? (await supabase.from("recebimento_itens").select("*").in("recebimento_id", ids)).data ?? [] : []);
    setCarregando(false);
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function abrirAnexo(caminho: string) {
    const { data } = await supabase.storage.from("anexos").createSignedUrl(caminho, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  async function encerrar() {
    const motivo = window.prompt("Encerrar o saldo pendente deste pedido (o fornecedor não vai entregar o resto). Motivo:");
    if (!motivo?.trim()) return;
    const { error } = await supabase.rpc("encerrar_pedido", { p_pedido: id, p_motivo: motivo.trim() });
    if (error) { setMsg({ ok: false, t: error.message }); return; }
    setMsg({ ok: true, t: "Pedido encerrado." });
    carregar();
  }

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!ped) return <p className="text-gray-400">Pedido não encontrado. <Link href="/e/pedidos_compra" className="text-brand-600">voltar</Link></p>;

  function msgWhats() {
    const linhas = itens.map((it) => `• ${prodNome[it.produto_id] ?? "-"} — ${Number(it.quantidade)} x ${formatCurrency(it.custo_unitario)} = ${formatCurrency(it.subtotal)}`).join("\n");
    return `*PEDIDO DE COMPRA ${ped!.numero ?? ""}*\nFornecedor: ${fornecedor?.nome ?? "-"}\nData: ${formatDate(ped!.data)} · Venc.: ${formatDate(ped!.vencimento)}\n\n${linhas}\n\nTOTAL: ${formatCurrency(ped!.valor_total)}${ped!.observacao ? `\nObs: ${ped!.observacao}` : ""}`;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href="/e/pedidos_compra" className="text-sm text-gray-500 hover:text-gray-800">← voltar</Link>
        <div className="flex items-center gap-2">
          {podeCompras && ["aberto", "parcial"].includes(ped.status) && (
            <button className="btn-ghost text-sm text-gray-500" onClick={encerrar} title="Fornecedor não vai entregar o restante">Encerrar saldo</button>
          )}
          {gerencia && <WhatsAppButton phone={fornecedor?.telefone} label="Enviar ao fornecedor" text={msgWhats()} />}
          <PrintButton />
        </div>
      </div>

      {msg && <div className={`no-print mb-4 rounded-lg p-3 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.t}</div>}
      {podeReceber && ["aberto", "parcial"].includes(ped.status) && (
        <ReceberPedido ped={ped} itens={itens as any} prodNome={prodNome} prodUn={prodUn}
          onRecebido={(t) => { setMsg({ ok: true, t }); carregar(); }} />
      )}

      <div className="doc rounded-xl bg-white p-8 text-gray-800 shadow-sm print:p-0 print:shadow-none">
        <DocHeader titulo="PEDIDO DE COMPRA" numero={ped.numero || "—"} />

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase text-gray-400">Fornecedor</p>
            <p className="font-medium">{fornecedor?.nome ?? "—"}</p>
            {fornecedor?.documento && <p className="text-xs text-gray-500">CNPJ {fornecedor.documento}</p>}
            {fornecedor?.telefone && <p className="text-xs text-gray-500">Tel {fornecedor.telefone}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
            <Campo rot="Data" val={formatDate(ped.data)} />
            <Campo rot="Vencimento" val={formatDate(ped.vencimento)} />
            <Campo rot="Depósito" val={deposito?.nome} />
            <div><p className="text-[11px] uppercase text-gray-400">Status</p><Badge value={ped.status} options={STATUS} /></div>
          </div>
        </div>

        <table className="mt-6 min-w-full text-sm">
          <thead className="border-b text-left text-xs uppercase text-gray-500">
            <tr><th className="py-2 pr-2">Produto</th><th className="py-2 pr-2 text-right">Qtd</th>
              <th className="py-2 pr-2 text-right print:hidden">Recebido</th>
              {gerencia && <><th className="py-2 pr-2 text-right">Custo unit.</th><th className="py-2 text-right">Subtotal</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itens.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center text-gray-400">Sem itens.</td></tr>
            ) : itens.map((it) => (
              <tr key={it.id}>
                <td className="py-2 pr-2">{prodNome[it.produto_id] ?? "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{qtdBR(it.quantidade)} <span className="text-xs text-gray-400">{prodUn[it.produto_id]}</span></td>
                <td className={`py-2 pr-2 text-right tabular-nums print:hidden ${Number(it.quantidade_recebida ?? 0) >= Number(it.quantidade) ? "text-green-700" : Number(it.quantidade_recebida ?? 0) > 0 ? "text-amber-700" : "text-gray-400"}`}>
                  {qtdBR(it.quantidade_recebida ?? 0)}
                </td>
                {gerencia && <>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatCurrency(it.custo_unitario)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{formatCurrency(it.subtotal)}</td>
                </>}
              </tr>
            ))}
          </tbody>
          {gerencia && (
            <tfoot className="border-t-2 border-brand-600 font-semibold">
              <tr><td colSpan={4} className="py-2 pr-2 text-right">VALOR TOTAL</td><td className="py-2 text-right text-brand-700">{formatCurrency(ped.valor_total)}</td></tr>
            </tfoot>
          )}
        </table>

        {ped.observacao && <p className="mt-4 text-sm text-gray-600"><b>Observação:</b> {ped.observacao}</p>}

        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div className="border-t border-gray-400 pt-2 text-center"><p className="font-medium">{EMISSORA.nome}</p><p className="text-xs text-gray-500">Comprador</p></div>
          <div className="border-t border-gray-400 pt-2 text-center"><p className="font-medium">{fornecedor?.nome ?? "Fornecedor"}</p><p className="text-xs text-gray-500">Fornecedor</p></div>
        </div>

        <div className="mt-8 border-t pt-3 text-center text-xs text-gray-400">
          {EMISSORA.nome} · CNPJ {EMISSORA.cnpj} · Pedido Nº {ped.numero || "—"} · {EMISSORA.sistema}
        </div>
      </div>

      {recebimentos.length > 0 && (
        <section className="no-print mt-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Recebimentos</h2>
          <div className="card divide-y divide-gray-100">
            {recebimentos.map((r) => {
              const its = recItens.filter((x) => x.recebimento_id === r.id);
              return (
                <div key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <b>{r.numero}</b>
                    <span className="text-gray-500">{formatDate(r.data)}</span>
                    {r.nota_fiscal && <span className="text-gray-600">NF {r.nota_fiscal}</span>}
                    {r.anexo_caminho && <button className="text-brand-700 hover:underline" onClick={() => abrirAnexo(r.anexo_caminho)}>📎 {r.anexo_nome ?? "nota fiscal"}</button>}
                    {gerencia && <span className="ml-auto font-medium tabular-nums">{formatCurrency(r.valor)}</span>}
                  </div>
                  <ul className="mt-1 text-xs text-gray-600">
                    {its.map((x) => (
                      <li key={x.id}>
                        {qtdBR(x.quantidade)} {prodUn[x.produto_id]} · {prodNome[x.produto_id] ?? "—"}
                        {x.divergencia && <span className="ml-1 text-amber-700">⚠ {x.divergencia}</span>}
                      </li>
                    ))}
                  </ul>
                  {r.observacao && <p className="mt-1 text-xs text-gray-500">{r.observacao}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Campo({ rot, val }: { rot: string; val: any }) {
  return <div><p className="text-[11px] uppercase text-gray-400">{rot}</p><p className="font-medium text-gray-800">{val || "—"}</p></div>;
}
