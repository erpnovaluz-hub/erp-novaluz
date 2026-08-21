"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { EMISSORA } from "@/lib/empresa";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import Badge from "@/components/Badge";
import WhatsAppButton from "@/components/WhatsAppButton";

type Row = Record<string, any>;
const STATUS = [
  { value: "aberto", label: "Aberto", color: "blue" },
  { value: "recebido", label: "Recebido", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];

export default function PedidoCompraDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [ped, setPed] = useState<Row | null>(null);
  const [itens, setItens] = useState<Row[]>([]);
  const [fornecedor, setFornecedor] = useState<Row | null>(null);
  const [deposito, setDeposito] = useState<Row | null>(null);
  const [prodNome, setProdNome] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const p = await supabase.from("pedidos_compra").select("*").eq("id", id).maybeSingle();
      const it = await supabase.from("itens_pedido_compra").select("*").eq("pedido_id", id);
      setPed(p.data); setItens(it.data ?? []);
      if (p.data?.fornecedor_id) setFornecedor((await supabase.from("fornecedores").select("*").eq("id", p.data.fornecedor_id).maybeSingle()).data);
      if (p.data?.deposito_id) setDeposito((await supabase.from("depositos").select("nome").eq("id", p.data.deposito_id).maybeSingle()).data);
      const prods = await supabase.from("produtos").select("id, nome").range(0, 4999);
      setProdNome(Object.fromEntries((prods.data ?? []).map((x: any) => [x.id, x.nome])));
      setCarregando(false);
    })();
  }, [supabase, id]);

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
          <WhatsAppButton phone={fornecedor?.telefone} label="Enviar ao fornecedor" text={msgWhats()} />
          <PrintButton />
        </div>
      </div>

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
            <tr><th className="py-2 pr-2">Produto</th><th className="py-2 pr-2 text-right">Qtd</th><th className="py-2 pr-2 text-right">Custo unit.</th><th className="py-2 text-right">Subtotal</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {itens.length === 0 ? (
              <tr><td colSpan={4} className="py-4 text-center text-gray-400">Sem itens.</td></tr>
            ) : itens.map((it) => (
              <tr key={it.id}>
                <td className="py-2 pr-2">{prodNome[it.produto_id] ?? "—"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{Number(it.quantidade)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{formatCurrency(it.custo_unitario)}</td>
                <td className="py-2 text-right font-medium tabular-nums">{formatCurrency(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-brand-600 font-semibold">
            <tr><td colSpan={3} className="py-2 pr-2 text-right">VALOR TOTAL</td><td className="py-2 text-right text-brand-700">{formatCurrency(ped.valor_total)}</td></tr>
          </tfoot>
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
    </div>
  );
}

function Campo({ rot, val }: { rot: string; val: any }) {
  return <div><p className="text-[11px] uppercase text-gray-400">{rot}</p><p className="font-medium text-gray-800">{val || "—"}</p></div>;
}
