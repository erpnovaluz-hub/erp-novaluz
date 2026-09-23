"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Tarefa, type VinculoTipo } from "@/lib/tarefas";
import { useEquipe } from "@/components/tarefas/comum";
import TarefaLinha from "@/components/tarefas/TarefaLinha";
import TarefaDrawer from "@/components/tarefas/TarefaDrawer";

// Bloco "Tarefas" dentro de um registro do ERP (OS, requisição…).
// Cria a tarefa já vinculada; mostra só as que o usuário pode ver (RLS).
export default function TarefasVinculadas({ tipo, id, rotulo }: { tipo: VinculoTipo; id: string; rotulo: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { porId, pessoas } = useEquipe();
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [novo, setNovo] = useState("");
  const [resp, setResp] = useState("");
  const [prazo, setPrazo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("vw_tarefas").select("*")
      .eq("vinculo_tipo", tipo).eq("vinculo_id", id).is("parent_id", null)
      .order("concluida").order("prazo", { ascending: true, nullsFirst: false });
    setTarefas((data ?? []) as Tarefa[]);
  }, [supabase, tipo, id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;
    const { error } = await supabase.from("tarefas").insert({
      titulo: novo.trim(), responsavel_id: resp || null, prazo: prazo || null, ordem: Date.now(),
      vinculo_tipo: tipo, vinculo_id: id, vinculo_rotulo: rotulo,
    });
    if (error) { setErro(error.message); return; }
    setNovo(""); setPrazo(""); carregar();
  }

  async function toggle(t: Tarefa) {
    await supabase.from("tarefas").update({ concluida: !t.concluida }).eq("id", t.id);
    carregar();
  }

  const abertas = tarefas.filter((t) => !t.concluida).length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">✅ Tarefas · {abertas} aberta(s)</h2>
      </div>
      {erro && <div className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</div>}
      <div className="card overflow-hidden">
        {tarefas.map((t) => (
          <TarefaLinha key={t.id} t={t} pessoa={t.responsavel_id ? porId[t.responsavel_id] : null}
            onAbrir={() => setAberta(t.id)} onToggle={() => toggle(t)} />
        ))}
        <form onSubmit={criar} className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-3 py-2">
          <span className="text-gray-300">+</span>
          <input className="min-w-[180px] flex-1 border-0 p-1 text-sm focus:ring-0" placeholder="Nova tarefa sobre este registro… (Enter)"
            value={novo} onChange={(e) => setNovo(e.target.value)} />
          <select className="inp w-40 py-1 text-sm" value={resp} onChange={(e) => setResp(e.target.value)}>
            <option value="">Responsável…</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
          </select>
          <input type="date" className="inp w-36 py-1 text-sm" value={prazo} onChange={(e) => setPrazo(e.target.value)} title="Prazo" />
        </form>
      </div>
      {aberta && <TarefaDrawer tarefaId={aberta} onClose={() => setAberta(null)} onChange={carregar} />}
    </section>
  );
}
