"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity } from "@/lib/entities";
import { formatCurrency, formatDate } from "@/lib/format";
import EntityForm from "@/components/EntityForm";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;
const ST_LABEL: Record<string, string> = { aberta: "Aberta", em_andamento: "Em andamento", bloqueada: "Bloqueada", concluida: "Concluída", cancelada: "Cancelada" };

const COLUNAS = [
  { key: "aberta", label: "Aberta", cor: "border-gray-300" },
  { key: "em_andamento", label: "Em andamento", cor: "border-blue-400" },
  { key: "bloqueada", label: "Bloqueada", cor: "border-red-400" },
  { key: "concluida", label: "Concluída", cor: "border-green-400" },
];
const PRIOR: Record<string, string> = { alta: "bg-red-100 text-red-700", media: "bg-amber-100 text-amber-700", baixa: "bg-gray-100 text-gray-600" };

export default function DemandasPanel() {
  const supabase = useMemo(() => createClient(), []);
  const hoje = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useState<Row[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [cliente, setCliente] = useState("");
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<Row | null | undefined>(undefined);

  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);

  useEffect(() => {
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("demandas").select("*");
    if (cliente) q = q.eq("cliente_id", cliente);
    const { data } = await q.order("data_solicitacao", { ascending: false }).range(0, 4999);
    setRows(data ?? []);
    setCarregando(false);
  }, [supabase, cliente]);

  useEffect(() => { carregar(); }, [carregar]);

  const filtradas = useMemo(() => {
    if (!busca.trim()) return rows;
    const b = busca.toLowerCase();
    return rows.filter((r) => `${r.titulo} ${r.solicitante} ${r.responsavel}`.toLowerCase().includes(b));
  }, [rows, busca]);

  const atrasada = (r: Row) => r.data_entrega_prevista && r.data_entrega_prevista < hoje && !["concluida", "cancelada"].includes(r.status);
  const nBloq = filtradas.filter((r) => r.status === "bloqueada").length;
  const nAtraso = filtradas.filter(atrasada).length;
  const valorAberto = filtradas.filter((r) => !["concluida", "cancelada"].includes(r.status)).reduce((s, r) => s + Number(r.valor_cobrado || 0), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📌 Painel de demandas</h1>
          <p className="text-sm text-gray-500">Demandas fora da produção · foco no cliente principal</p>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton label="Relatório PDF" />
          <button className="no-print btn-primary" onClick={() => setEditando(null)}>+ Nova demanda</button>
        </div>
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <select className="inp !w-auto py-1.5" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <input className="inp !w-56 py-1.5" placeholder="Buscar título / solicitante / responsável…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="mb-4 flex flex-wrap gap-6 text-sm text-gray-500">
        <span>{filtradas.length} demanda(s)</span>
        <span>Bloqueadas: <b className="text-red-600">{nBloq}</b></span>
        <span>Atrasadas: <b className="text-amber-600">{nAtraso}</b></span>
        <span>Valor em aberto: <b className="text-gray-900">{formatCurrency(valorAberto)}</b></span>
      </div>

      {carregando ? (
        <div className="card p-12 text-center text-gray-400">Carregando…</div>
      ) : (
        <div className="no-print grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUNAS.map((col) => {
            const cards = filtradas.filter((r) => r.status === col.key);
            return (
              <div key={col.key} className="rounded-xl bg-gray-50 p-2">
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <span className="text-sm font-semibold text-gray-700">{col.label}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">{cards.length}</span>
                </div>
                <div className="space-y-2">
                  {cards.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-gray-300">—</p>
                  ) : cards.map((r) => (
                    <button key={r.id} onClick={() => setEditando(r)}
                      className={`block w-full rounded-lg border-l-4 bg-white p-3 text-left shadow-sm transition hover:shadow ${col.cor}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900">{r.titulo}</p>
                        {r.prioridade && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${PRIOR[r.prioridade]}`}>{r.prioridade}</span>}
                      </div>
                      <p className="mt-1 text-xs text-gray-400">{cliNome[r.cliente_id] ?? ""}{r.solicitante ? ` · ${r.solicitante}` : ""}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        {r.responsavel && <span>👤 {r.responsavel}</span>}
                        {r.valor_cobrado != null && <span>{formatCurrency(r.valor_cobrado)}</span>}
                        {r.data_entrega_prevista && <span className={atrasada(r) ? "font-medium text-red-600" : ""}>📅 {formatDate(r.data_entrega_prevista)}{atrasada(r) ? " ⚠" : ""}</span>}
                      </div>
                      {r.status === "bloqueada" && r.bloqueio && (
                        <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">🚧 {r.bloqueio}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* tabela detalhada — só na impressão */}
      <div className="print-only mt-4">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-b-2 border-gray-400 text-left">
              <th className="py-1 pr-2">Demanda</th><th className="py-1 pr-2">Cliente</th><th className="py-1 pr-2">Solicitante</th>
              <th className="py-1 pr-2">Responsável</th><th className="py-1 pr-2">Solic.</th><th className="py-1 pr-2">Entrega</th>
              <th className="py-1 pr-2 text-right">Valor</th><th className="py-1 pr-2">Status</th><th className="py-1">Bloqueio</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((r) => (
              <tr key={r.id} className="border-b border-gray-200 align-top">
                <td className="py-1 pr-2">{r.titulo}</td>
                <td className="py-1 pr-2">{cliNome[r.cliente_id] ?? "—"}</td>
                <td className="py-1 pr-2">{r.solicitante ?? "—"}</td>
                <td className="py-1 pr-2">{r.responsavel ?? "—"}</td>
                <td className="py-1 pr-2">{formatDate(r.data_solicitacao)}</td>
                <td className="py-1 pr-2">{formatDate(r.data_entrega_prevista)}</td>
                <td className="py-1 pr-2 text-right">{r.valor_cobrado != null ? formatCurrency(r.valor_cobrado) : "—"}</td>
                <td className="py-1 pr-2">{ST_LABEL[r.status] ?? r.status}</td>
                <td className="py-1">{r.bloqueio ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando !== undefined && (
        <EntityForm
          entity={getEntity("demandas")!}
          registro={editando}
          refOptions={{ cliente_id: clientes.map((c) => ({ value: c.id, label: c.nome })) }}
          onClose={() => setEditando(undefined)}
          onSaved={() => { setEditando(undefined); carregar(); }}
        />
      )}
    </div>
  );
}
