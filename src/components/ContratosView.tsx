"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity } from "@/lib/entities";
import { formatCurrency, formatDate } from "@/lib/format";
import Badge from "@/components/Badge";
import EntityForm from "@/components/EntityForm";

type Row = Record<string, any>;
const STATUS = getEntity("contratos")!.fields.find((f) => f.key === "status")!.options!;

export default function ContratosView() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [propostas, setPropostas] = useState<{ id: string; numero: string }[]>([]);
  const [cliente, setCliente] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(false);

  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);

  useEffect(() => {
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
    supabase.from("propostas").select("id, numero").order("data", { ascending: false }).range(0, 4999).then(({ data }) => setPropostas(data ?? []));
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("contratos").select("*");
    if (cliente) q = q.eq("cliente_id", cliente);
    const { data } = await q.order("data_inicio", { ascending: false, nullsFirst: false }).range(0, 4999);
    setRows(data ?? []); setCarregando(false);
  }, [supabase, cliente]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📜 Contratos</h1>
        <button className="btn-primary" onClick={() => setNovo(true)}>+ Novo contrato</button>
      </div>

      <div className="mb-4">
        <select className="inp !w-auto py-1.5" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {carregando ? (
          <div className="px-4 py-12 text-center text-gray-400">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">Nenhum contrato.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/contratos/${r.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{r.numero || "(sem número)"} · {cliNome[r.cliente_id] ?? "—"}</p>
                    <p className="truncate text-xs text-gray-400">{r.objeto || "sem objeto"}</p>
                  </div>
                  <div className="w-28 shrink-0 text-right font-medium tabular-nums text-gray-900">{formatCurrency(r.valor)}</div>
                  <div className="w-24 shrink-0 text-right text-xs text-gray-500">{formatDate(r.data_inicio)}</div>
                  <div className="w-24 shrink-0 text-right"><Badge value={r.status} options={STATUS} /></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {novo && (
        <EntityForm
          entity={getEntity("contratos")!}
          registro={{ status: "ativo", tipo: "pontual", data_inicio: new Date().toISOString().slice(0, 10) }}
          refOptions={{
            cliente_id: clientes.map((c) => ({ value: c.id, label: c.nome })),
            proposta_id: propostas.map((p) => ({ value: p.id, label: p.numero })),
          }}
          onClose={() => setNovo(false)}
          onSaved={() => { setNovo(false); carregar(); }}
        />
      )}
    </div>
  );
}
