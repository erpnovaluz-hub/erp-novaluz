"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { formatDate } from "@/lib/format";

const STATUS = [
  { value: "aberta", label: "Em aberto", color: "blue" },
  { value: "parcial", label: "Devolvida em parte", color: "amber" },
  { value: "devolvida", label: "Devolvida", color: "green" },
];

// Cautelas (abertas primeiro). Atrasada = previsão de devolução vencida e ainda em aberto.
export default function CautelasLista() {
  const supabase = useMemo(() => createClient(), []);
  const podeEditar = usePode("estoque", "editar");
  const [lista, setLista] = useState<any[]>([]);
  const [equipe, setEquipe] = useState<Record<string, string>>({});
  const [itens, setItens] = useState<Record<string, { total: number; abertos: number }>>({});
  const [soAbertas, setSoAbertas] = useState(true);

  useEffect(() => {
    let q = supabase.from("cautelas").select("*").order("data_saida", { ascending: false }).limit(300);
    if (soAbertas) q = q.neq("status", "devolvida");
    Promise.all([q, supabase.from("vw_equipe").select("id, nome").range(0, 4999),
      supabase.from("cautela_itens").select("cautela_id, devolvido_em").range(0, 49999)]).then(([c, e, it]) => {
      setLista(c.data ?? []);
      setEquipe(Object.fromEntries(((e.data ?? []) as any[]).map((x) => [x.id, x.nome])));
      const m: Record<string, { total: number; abertos: number }> = {};
      for (const r of (it.data ?? []) as any[]) { const x = (m[r.cautela_id] ??= { total: 0, abertos: 0 }); x.total++; if (!r.devolvido_em) x.abertos++; }
      setItens(m);
    });
  }, [supabase, soAbertas]);

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📋 Cautelas de ferramentas</h1>
          <p className="text-sm text-gray-500">Quem está com o quê, e até quando.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/estoque/ferramentas" className="btn-ghost text-sm ring-1 ring-gray-200">🔧 Ferramentas</Link>
          {podeEditar && <Link href="/estoque/cautela/nova" className="btn-primary text-sm">📤 Nova cautela</Link>}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={soAbertas} onChange={(e) => setSoAbertas(e.target.checked)} /> só em aberto
      </label>
      <div className="card divide-y divide-gray-100 overflow-hidden">
        {lista.length === 0 ? <p className="px-4 py-10 text-center text-sm text-gray-400">Nenhuma cautela.</p>
          : lista.map((c) => {
            const n = itens[c.id] ?? { total: 0, abertos: 0 };
            const atrasada = c.status !== "devolvida" && c.previsao_devolucao && c.previsao_devolucao < hoje;
            return (
              <Link key={c.id} href={`/estoque/cautela/${c.id}`} className="linha-lista flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                <div className="linha-principal min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{c.numero} · 👷 {equipe[c.colaborador_id] ?? "—"}</p>
                  <p className="truncate text-xs text-gray-400">{n.abertos} de {n.total} ferramenta(s) com o colaborador</p>
                </div>
                <div className="w-24 shrink-0 text-right text-xs text-gray-500">{formatDate(c.data_saida)}</div>
                <div className={`w-32 shrink-0 text-right text-xs ${atrasada ? "font-medium text-red-600" : "text-gray-500"}`}>
                  {c.previsao_devolucao ? `até ${formatDate(c.previsao_devolucao)}` : "sem prazo"}{atrasada ? " ⚠" : ""}
                </div>
                <div className="w-36 shrink-0 text-right"><Badge value={c.status} options={STATUS} /></div>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
