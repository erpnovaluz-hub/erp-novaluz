"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { EMISSORA } from "@/lib/empresa";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import Badge from "@/components/Badge";
import { getEntity } from "@/lib/entities";

type Row = Record<string, any>;
const STATUS_ATIV = getEntity("atividades_os")!.fields.find((f) => f.key === "status")!.options!;

export default function OSDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [os, setOs] = useState<Row | null>(null);
  const [atividades, setAtividades] = useState<Row[]>([]);
  const [insumos, setInsumos] = useState<Row[]>([]);
  const [cliente, setCliente] = useState<Row | null>(null);
  const [colNome, setColNome] = useState<Record<string, string>>({});
  const [prodNome, setProdNome] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const o = await supabase.from("ordens_servico").select("*").eq("id", id).maybeSingle();
      const a = await supabase.from("atividades_os").select("*").eq("os_id", id).order("data_inicio", { ascending: true, nullsFirst: false });
      const i = await supabase.from("insumos_os").select("*").eq("os_id", id);
      setOs(o.data); setAtividades(a.data ?? []); setInsumos(i.data ?? []);
      if (o.data?.cliente_id) setCliente((await supabase.from("clientes").select("*").eq("id", o.data.cliente_id).maybeSingle()).data);
      const col = await supabase.from("colaboradores").select("id, nome").range(0, 4999);
      setColNome(Object.fromEntries((col.data ?? []).map((x: any) => [x.id, x.nome])));
      const pr = await supabase.from("produtos").select("id, nome").range(0, 4999);
      setProdNome(Object.fromEntries((pr.data ?? []).map((x: any) => [x.id, x.nome])));
      setCarregando(false);
    })();
  }, [supabase, id]);

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!os) return <p className="text-gray-400">OS não encontrada. <Link href="/os" className="text-brand-600">voltar</Link></p>;

  const custoInsumos = insumos.reduce((s, r) => s + Number(r.custo_total || 0), 0);
  const progresso = atividades.length ? Math.round(atividades.reduce((s, a) => s + Number(a.conclusao_pct || 0), 0) / atividades.length) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/os/${id}`} className="text-sm text-gray-500 hover:text-gray-800">← voltar</Link>
        <PrintButton />
      </div>

      <div className="doc rounded-xl bg-white p-8 text-gray-800 shadow-sm print:p-0 print:shadow-none">
        <DocHeader titulo="ORDEM DE SERVIÇO" subtitulo={os.titulo} />

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase text-gray-400">Cliente</p>
            <p className="font-medium">{cliente?.nome ?? "—"}</p>
            {cliente?.cnpj && <p className="text-xs text-gray-500">CNPJ {cliente.cnpj}</p>}
            {os.local && <p className="text-xs text-gray-500">Local: {os.local}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
            <Campo rot="Responsável" val={os.responsavel} />
            <Campo rot="Prazo" val={formatDate(os.prazo)} />
            <Campo rot="Custo estimado" val={formatCurrency(os.custo_estimado)} />
            <Campo rot="Progresso" val={`${progresso}%`} />
          </div>
        </div>

        {(os.motivo || os.como_sera_feito) && (
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {os.motivo && <div><p className="text-[11px] uppercase text-gray-400">Por quê</p><p className="text-gray-700">{os.motivo}</p></div>}
            {os.como_sera_feito && <div><p className="text-[11px] uppercase text-gray-400">Como será feito</p><p className="text-gray-700">{os.como_sera_feito}</p></div>}
          </div>
        )}

        <h3 className="mt-6 mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">Atividades</h3>
        <table className="min-w-full text-sm">
          <thead className="border-b text-left text-xs uppercase text-gray-500">
            <tr><th className="py-2 pr-2">Atividade</th><th className="py-2 pr-2">Responsável</th><th className="py-2 pr-2">Prazo</th><th className="py-2 pr-2 text-right">%</th><th className="py-2 text-right">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {atividades.length === 0 ? (
              <tr><td colSpan={5} className="py-3 text-center text-gray-400">Sem atividades.</td></tr>
            ) : atividades.map((a) => (
              <tr key={a.id}>
                <td className="py-2 pr-2">{a.descricao}</td>
                <td className="py-2 pr-2 text-gray-600">{colNome[a.colaborador_id] ?? "—"}</td>
                <td className="py-2 pr-2 text-gray-600">{formatDate(a.data_fim)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{Number(a.conclusao_pct || 0)}%</td>
                <td className="py-2 text-right"><Badge value={a.status} options={STATUS_ATIV} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        {insumos.length > 0 && (
          <>
            <h3 className="mt-6 mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">Insumos · {formatCurrency(custoInsumos)}</h3>
            <table className="min-w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-gray-500">
                <tr><th className="py-2 pr-2">Insumo</th><th className="py-2 pr-2">Produto</th><th className="py-2 pr-2 text-right">Qtd</th><th className="py-2 pr-2 text-right">Custo un.</th><th className="py-2 text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {insumos.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-2">{i.descricao}</td>
                    <td className="py-2 pr-2 text-gray-600">{prodNome[i.produto_id] ?? "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{Number(i.quantidade)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatCurrency(i.custo_unitario)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatCurrency(i.custo_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div className="border-t border-gray-400 pt-2 text-center"><p className="font-medium">{EMISSORA.nome}</p><p className="text-xs text-gray-500">Executor</p></div>
          <div className="border-t border-gray-400 pt-2 text-center"><p className="font-medium">{cliente?.nome ?? "Cliente"}</p><p className="text-xs text-gray-500">Cliente / Aprovação</p></div>
        </div>

        <div className="mt-8 border-t pt-3 text-center text-xs text-gray-400">
          {EMISSORA.nome} · CNPJ {EMISSORA.cnpj} · {EMISSORA.sistema}
        </div>
      </div>
    </div>
  );
}

function Campo({ rot, val }: { rot: string; val: any }) {
  return <div><p className="text-[11px] uppercase text-gray-400">{rot}</p><p className="font-medium text-gray-800">{val || "—"}</p></div>;
}
