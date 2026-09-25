"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import type { Pessoa } from "@/lib/tarefas";
import { Avatar } from "@/components/tarefas/comum";

// Acompanhantes da tarefa: veem a tarefa e são avisados de comentários e da conclusão.
export default function TarefaAcompanhantes({ tarefaId, responsavelId, pessoas, porId, onChange }: {
  tarefaId: string; responsavelId: string | null; pessoas: Pessoa[]; porId: Record<string, Pessoa>; onChange?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { userId } = useAcesso();
  const [ids, setIds] = useState<string[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("tarefa_acompanhantes").select("perfil_id").eq("tarefa_id", tarefaId);
    setIds(((data ?? []) as any[]).map((r) => r.perfil_id));
  }, [supabase, tarefaId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function incluir(perfilId: string) {
    setAdicionando(false);
    if (!perfilId) return;
    setIds((l) => [...l, perfilId]);
    const { error } = await supabase.from("tarefa_acompanhantes").insert({ tarefa_id: tarefaId, perfil_id: perfilId });
    if (error) { setErro(error.message); carregar(); return; }
    setErro(null); onChange?.();
  }

  async function remover(perfilId: string) {
    setIds((l) => l.filter((x) => x !== perfilId));
    const { error } = await supabase.from("tarefa_acompanhantes").delete().match({ tarefa_id: tarefaId, perfil_id: perfilId });
    if (error) { setErro(error.message); carregar(); return; }
    onChange?.();
  }

  const disponiveis = pessoas.filter((p) => !ids.includes(p.id) && p.id !== responsavelId);
  const eu = userId ? ids.includes(userId) : false;
  const souResponsavel = userId === responsavelId;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ids.map((id) => {
          const p = porId[id];
          return (
            <span key={id} className="group inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-0.5 pr-2 text-xs text-gray-700">
              <Avatar pessoa={p ?? null} size={20} />
              {(p?.nome || p?.email || "—").split(" ")[0]}
              <button type="button" className="ml-0.5 text-gray-400 opacity-0 hover:text-red-500 group-hover:opacity-100"
                onClick={() => remover(id)} aria-label={`Remover ${p?.nome ?? ""}`}>×</button>
            </span>
          );
        })}
        {adicionando ? (
          <select autoFocus className="inp w-auto py-1 text-xs" defaultValue="" onBlur={() => setAdicionando(false)}
            onChange={(e) => incluir(e.target.value)}>
            <option value="">— escolher pessoa —</option>
            {disponiveis.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
          </select>
        ) : disponiveis.length > 0 && (
          <button type="button" className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-700"
            onClick={() => setAdicionando(true)}>+ adicionar</button>
        )}
        {!souResponsavel && userId && (
          <button type="button" className="ml-auto text-xs text-brand-600 hover:underline" onClick={() => (eu ? remover(userId) : incluir(userId))}>
            {eu ? "🔕 deixar de acompanhar" : "🔔 acompanhar"}
          </button>
        )}
      </div>
      {ids.length === 0 && !adicionando && <p className="mt-0.5 text-[11px] text-gray-400">Quem mais precisa ficar sabendo (recebe aviso de comentários e da conclusão).</p>}
      {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
    </div>
  );
}
