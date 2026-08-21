"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";

type Row = Record<string, any>;

export default function PrecificadorList() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Row[]>([]);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("produtos").select("id, nome, categoria, custo_direto, margem_alvo, preco_sugerido, preco_lista").eq("ativo", true);
    if (buscaAtiva.trim()) q = q.ilike("nome", `%${buscaAtiva.trim()}%`);
    const { data } = await q.order("nome").range(0, 4999);
    setRows(data ?? []);
    setCarregando(false);
  }, [supabase, buscaAtiva]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">🧮 Precificador</h1>
          <p className="text-sm text-gray-500">Composição de custo, preço sugerido e análise de margem</p>
        </div>
        <Link href="/precificador/parametros" className="btn-ghost text-sm ring-1 ring-gray-200">⚙️ Parâmetros</Link>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setBuscaAtiva(busca); }} className="mb-4">
        <input className="inp w-64" placeholder="Buscar produto/serviço…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </form>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2 text-right">Custo direto</th>
              <th className="px-4 py-2 text-right">Margem alvo</th>
              <th className="px-4 py-2 text-right">Preço sugerido</th>
              <th className="px-4 py-2 text-right">Preço lista</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {carregando ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Carregando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Nenhum item.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-gray-50" onClick={() => (window.location.href = `/precificador/${r.id}`)}>
                <td className="px-4 py-2 font-medium text-gray-800">{r.nome}</td>
                <td className="px-4 py-2 text-gray-500">{r.categoria ?? "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(r.custo_direto)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(r.margem_alvo || 0)}%</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums text-brand-600">{formatCurrency(r.preco_sugerido)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-500">{formatCurrency(r.preco_lista)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
