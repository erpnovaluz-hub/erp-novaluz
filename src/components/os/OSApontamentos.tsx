"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import { formatDate } from "@/lib/format";
import ApontarForm, { TIPOS_HORA } from "@/components/os/ApontarForm";

type Apont = { id: string; colaborador_id: string; atividade_id: string | null; data: string; horas: number; tipo: string; observacao: string | null };
const hBR = (n: number) => `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h`;

// Horas trabalhadas na OS (sem valores — custo só no Resultado, para a gerência).
export default function OSApontamentos({ osId, atividades, onChange }: {
  osId: string; atividades: { id: string; descricao: string; conclusao_pct?: number | null }[]; onChange?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const podeEditar = usePode("os", "editar");
  const [lista, setLista] = useState<Apont[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [abrir, setAbrir] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [a, e] = await Promise.all([
      supabase.from("os_apontamentos").select("*").eq("os_id", osId).order("data", { ascending: false }).range(0, 4999),
      supabase.from("vw_equipe").select("id, nome").range(0, 4999),
    ]);
    setLista((a.data ?? []) as Apont[]);
    setNomes(Object.fromEntries(((e.data ?? []) as any[]).map((x) => [x.id, x.nome])));
  }, [supabase, osId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function excluir(a: Apont) {
    if (!confirm(`Excluir ${hBR(a.horas)} de ${nomes[a.colaborador_id] ?? "—"} em ${formatDate(a.data)}?`)) return;
    await supabase.from("os_apontamentos").delete().eq("id", a.id);
    carregar(); onChange?.();
  }

  const total = lista.reduce((s, a) => s + Number(a.horas), 0);
  const porPessoa = Object.entries(lista.reduce<Record<string, number>>((m, a) => ({ ...m, [a.colaborador_id]: (m[a.colaborador_id] ?? 0) + Number(a.horas) }), {}))
    .sort((a, b) => b[1] - a[1]);
  const ativNome = Object.fromEntries(atividades.map((a) => [a.id, a.descricao]));

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">⏱️ Horas apontadas · {hBR(total)}</h2>
        {podeEditar && <button className="btn-ghost text-sm text-brand-600" onClick={() => setAbrir((v) => !v)}>{abrir ? "fechar" : "+ Apontar"}</button>}
      </div>
      {msg && <div className="mb-2 rounded-lg bg-green-50 p-2 text-sm text-green-700">{msg}</div>}
      {abrir && (
        <div className="card mb-3 p-4">
          <ApontarForm osId={osId} atividades={atividades}
            onSalvo={(n) => { setMsg(`${n} apontamento(s) registrado(s).`); setAbrir(false); carregar(); onChange?.(); }} />
        </div>
      )}
      {porPessoa.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 text-xs">
          {porPessoa.map(([id, h]) => <span key={id} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{nomes[id] ?? "—"}: <b>{hBR(h)}</b></span>)}
        </div>
      )}
      <div className="card overflow-hidden">
        {lista.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">Nenhuma hora apontada ainda.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {lista.map((a) => (
              <li key={a.id} className="group flex items-center gap-3 px-4 py-2">
                <span className="w-20 shrink-0 text-xs text-gray-500">{formatDate(a.data)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {nomes[a.colaborador_id] ?? "—"}
                  {a.atividade_id && <span className="text-xs text-gray-400"> · {ativNome[a.atividade_id] ?? "atividade"}</span>}
                  {a.observacao && <span className="text-xs text-gray-400"> · {a.observacao}</span>}
                </span>
                {a.tipo !== "normal" && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">{TIPOS_HORA.find((t) => t.value === a.tipo)?.label}</span>}
                <span className="w-14 shrink-0 text-right font-medium tabular-nums">{hBR(a.horas)}</span>
                {podeEditar && <button className="text-xs text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100" onClick={() => excluir(a)}>excluir</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
