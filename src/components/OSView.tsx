"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity } from "@/lib/entities";
import { formatCurrency, formatDate } from "@/lib/format";
import Badge from "@/components/Badge";
import EntityForm from "@/components/EntityForm";

type Row = Record<string, any>;
const STATUS_OS = [
  { value: "a_fazer", label: "A fazer", color: "gray" },
  { value: "em_andamento", label: "Em andamento", color: "blue" },
  { value: "concluido", label: "Concluído", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];
const URGENCIA = [
  { value: "baixa", label: "Baixa", color: "gray" },
  { value: "media", label: "Média", color: "amber" },
  { value: "alta", label: "Alta", color: "red" },
];

export default function OSView() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [resumo, setResumo] = useState<Record<string, any>>({});
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [contratos, setContratos] = useState<{ id: string; numero: string }[]>([]);
  const [propostas, setPropostas] = useState<{ id: string; numero: string }[]>([]);
  const [cliente, setCliente] = useState("");
  const [status, setStatus] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(false);

  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);

  useEffect(() => {
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
    supabase.from("contratos").select("id, numero").order("data_inicio", { ascending: false }).range(0, 4999).then(({ data }) => setContratos(data ?? []));
    supabase.from("propostas").select("id, numero").order("data", { ascending: false }).range(0, 4999).then(({ data }) => setPropostas(data ?? []));
    supabase.from("vw_os_resumo").select("*").then(({ data }) =>
      setResumo(Object.fromEntries((data ?? []).map((r: any) => [r.os_id, r]))));
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("ordens_servico").select("*");
    if (cliente) q = q.eq("cliente_id", cliente);
    if (status) q = q.eq("status", status);
    if (buscaAtiva.trim()) q = q.ilike("titulo", `%${buscaAtiva.trim()}%`);
    const { data } = await q.order("prazo", { ascending: true, nullsFirst: false }).range(0, 4999);
    setRows(data ?? []);
    setCarregando(false);
  }, [supabase, cliente, status, buscaAtiva]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📋 Ordens de Serviço</h1>
        <button className="btn-primary" onClick={() => setNovo(true)}>+ Nova OS</button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="inp !w-auto py-1.5" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_OS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setBuscaAtiva(busca); }}>
          <input className="inp !w-52 py-1.5" placeholder="Buscar título…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </form>
      </div>

      <div className="card overflow-hidden">
        {carregando ? (
          <div className="px-4 py-12 text-center text-gray-400">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">Nenhuma OS.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const res = resumo[r.id];
              const prog = res ? Number(res.progresso_pct || 0) : 0;
              return (
                <li key={r.id}>
                  <Link href={`/os/${r.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-900">{r.titulo}</p>
                      <p className="truncate text-xs text-gray-400">
                        {cliNome[r.cliente_id] ?? "—"}{r.responsavel ? ` · ${r.responsavel}` : ""}
                        {res ? ` · ${res.atividades} atividade(s)` : ""}
                      </p>
                    </div>
                    <div className="hidden w-28 shrink-0 sm:block">
                      <div className="h-1.5 w-full rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(100, prog)}%` }} />
                      </div>
                      <p className="mt-1 text-right text-[10px] text-gray-400">{prog}%</p>
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs text-gray-500">{formatDate(r.prazo)}</div>
                    <div className="w-20 shrink-0 text-right"><Badge value={r.urgencia} options={URGENCIA} /></div>
                    <div className="w-28 shrink-0 text-right"><Badge value={r.status} options={STATUS_OS} /></div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {novo && (
        <EntityForm
          entity={getEntity("ordens_servico")!}
          registro={null}
          refOptions={{
            cliente_id: clientes.map((c) => ({ value: c.id, label: c.nome })),
            contrato_id: contratos.map((c) => ({ value: c.id, label: c.numero })),
            proposta_id: propostas.map((p) => ({ value: p.id, label: p.numero })),
          }}
          onClose={() => setNovo(false)}
          onSaved={() => { setNovo(false); carregar(); }}
        />
      )}
    </div>
  );
}
