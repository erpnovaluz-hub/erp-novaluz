"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity } from "@/lib/entities";
import { formatCurrency, formatDate } from "@/lib/format";
import Badge from "@/components/Badge";
import EntityForm from "@/components/EntityForm";

type Row = Record<string, any>;
const STATUS = getEntity("contratos")!.fields.find((f) => f.key === "status")!.options!;

export default function ContratoComposer({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [ctr, setCtr] = useState<Row | null>(null);
  const [clientes, setClientes] = useState<any[]>([]);
  const [propostas, setPropostas] = useState<any[]>([]);
  const [proposta, setProposta] = useState<Row | null>(null);
  const [editar, setEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const c = await supabase.from("contratos").select("*").eq("id", id).maybeSingle();
    setCtr(c.data);
    if (c.data?.proposta_id) setProposta((await supabase.from("propostas").select("id, numero").eq("id", c.data.proposta_id).maybeSingle()).data);
    setCarregando(false);
  }, [supabase, id]);

  useEffect(() => {
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
    supabase.from("propostas").select("id, numero").order("data", { ascending: false }).range(0, 4999).then(({ data }) => setPropostas(data ?? []));
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  async function excluir() {
    if (!confirm("Excluir este contrato?")) return;
    await supabase.from("contratos").delete().eq("id", id);
    router.push("/contratos");
  }

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!ctr) return <p className="text-gray-400">Contrato não encontrado. <Link href="/contratos" className="text-brand-600">voltar</Link></p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/contratos" className="hover:text-gray-700">Contratos</Link> <span>/</span> <span className="text-gray-600">{ctr.numero || "(sem número)"}</span>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{ctr.numero || "(sem número)"} · {cliNome[ctr.cliente_id] ?? "—"}</h1>
            <p className="mt-1 text-sm text-gray-500">{ctr.objeto || "sem objeto"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge value={ctr.status} options={STATUS} />
            <Link href={`/contratos/${id}/documento`} className="btn-primary text-sm">📜 Ver documento / PDF</Link>
            <button className="btn-ghost text-sm" onClick={() => setEditar(true)}>Editar</button>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Info rot="Início" val={formatDate(ctr.data_inicio)} />
          <Info rot="Fim" val={formatDate(ctr.data_fim)} />
          <Info rot="Valor" val={formatCurrency(ctr.valor)} />
          <Info rot="Proposta de origem" val={proposta ? proposta.numero : "—"} />
        </div>
      </div>

      <button className="text-sm text-red-500 hover:underline" onClick={excluir}>Excluir este contrato</button>

      {editar && (
        <EntityForm
          entity={getEntity("contratos")!}
          registro={ctr}
          refOptions={{
            cliente_id: clientes.map((c) => ({ value: c.id, label: c.nome })),
            proposta_id: propostas.map((p) => ({ value: p.id, label: p.numero })),
          }}
          onClose={() => setEditar(false)}
          onSaved={() => { setEditar(false); carregar(); }}
        />
      )}
    </div>
  );
}

function Info({ rot, val }: { rot: string; val: any }) {
  return <div><p className="text-xs text-gray-400">{rot}</p><p className="font-medium text-gray-800">{val || "—"}</p></div>;
}
