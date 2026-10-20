"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { formatDate } from "@/lib/format";

const STATUS_REQ = [
  { value: "aberta", label: "Aberta", color: "blue" },
  { value: "atendida_parcial", label: "Atendida em parte", color: "amber" },
  { value: "atendida", label: "Atendida", color: "green" },
  { value: "convertida", label: "Em compra", color: "purple" },
  { value: "cancelada", label: "Cancelada", color: "gray" },
];

// Requisições de material e ferramentas cauteladas para esta OS + atalhos com a OS já como destino.
export default function OSMateriais({ osId }: { osId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const podeRequisitar = usePode("requisicoes", "editar");
  const podeCautelar = usePode("estoque", "editar");
  const [reqs, setReqs] = useState<any[]>([]);
  const [ferr, setFerr] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("requisicoes_compra").select("id, numero, data, status, solicitante").eq("os_id", osId).order("data", { ascending: false })
      .then(({ data }) => setReqs(data ?? []));
    (async () => {
      const { data: ks } = await supabase.from("cautelas").select("id, numero, colaborador_id, previsao_devolucao").eq("os_id", osId).neq("status", "devolvida");
      const ids = (ks ?? []).map((k: any) => k.id);
      if (!ids.length) { setFerr([]); return; }
      const { data: its } = await supabase.from("cautela_itens").select("cautela_id, ferramenta_id, ferramentas(codigo, descricao)").in("cautela_id", ids).is("devolvido_em", null);
      const kPorId = Object.fromEntries((ks ?? []).map((k: any) => [k.id, k]));
      setFerr((its ?? []).map((i: any) => ({ ...i, cautela: kPorId[i.cautela_id] })));
    })();
  }, [supabase, osId]);

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <section className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">📝 Requisições de material</h2>
          {podeRequisitar && <Link href={`/compras/requisicao/nova?os=${osId}`} className="btn-ghost text-sm text-brand-600">+ Requisitar</Link>}
        </div>
        <div className="card divide-y divide-gray-100 text-sm">
          {reqs.length === 0 ? <p className="px-4 py-5 text-center text-gray-400">Nenhuma requisição para esta OS.</p>
            : reqs.map((r) => (
              <Link key={r.id} href={`/compras/requisicao/${r.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50">
                <span className="font-medium">{r.numero ?? "requisição"}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{formatDate(r.data)}{r.solicitante ? ` · ${r.solicitante}` : ""}</span>
                <Badge value={r.status} options={STATUS_REQ} />
              </Link>
            ))}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">🔧 Ferramentas na OS</h2>
          {podeCautelar && <Link href={`/estoque/cautela/nova?os=${osId}`} className="btn-ghost text-sm text-brand-600">+ Cautelar</Link>}
        </div>
        <div className="card divide-y divide-gray-100 text-sm">
          {ferr.length === 0 ? <p className="px-4 py-5 text-center text-gray-400">Nenhuma ferramenta cautelada para esta OS.</p>
            : ferr.map((f, k) => {
              const atrasada = f.cautela?.previsao_devolucao && f.cautela.previsao_devolucao < hoje;
              return (
                <Link key={k} href={`/estoque/ferramentas/${f.ferramenta_id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50">
                  <span className="font-mono text-xs text-gray-500">{f.ferramentas?.codigo}</span>
                  <span className="min-w-0 flex-1 truncate">{f.ferramentas?.descricao}</span>
                  <span className={`text-xs ${atrasada ? "font-medium text-red-600" : "text-gray-400"}`}>
                    {f.cautela?.numero}{f.cautela?.previsao_devolucao ? ` · até ${formatDate(f.cautela.previsao_devolucao)}` : ""}{atrasada ? " ⚠" : ""}
                  </span>
                </Link>
              );
            })}
        </div>
      </div>
    </section>
  );
}
