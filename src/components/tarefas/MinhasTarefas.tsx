"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { FAIXAS, faixaDoPrazo, hojeISO, type Projeto, type Tarefa } from "@/lib/tarefas";
import { useEquipe } from "@/components/tarefas/comum";
import TarefaLinha from "@/components/tarefas/TarefaLinha";
import TarefaDrawer from "@/components/tarefas/TarefaDrawer";
import CalendarioTarefas from "@/components/tarefas/CalendarioTarefas";

type Aba = "proximas" | "calendario" | "delegadas" | "concluidas";

export default function MinhasTarefas() {
  const supabase = useMemo(() => createClient(), []);
  const { userId } = useAcesso();
  const { porId } = useEquipe();
  const [aba, setAba] = useState<Aba>("proximas");
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [delegadas, setDelegadas] = useState<Tarefa[]>([]);
  const [concluidas, setConcluidas] = useState<Tarefa[]>([]);
  const [projetos, setProjetos] = useState<Record<string, Projeto>>({});
  const [aberta, setAberta] = useState<string | null>(null);
  const [novo, setNovo] = useState("");
  const [novoPrazo, setNovoPrazo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!userId) return;
    const trintaDias = new Date(Date.now() - 30 * 86400000).toISOString();
    const [a, b, c, p] = await Promise.all([
      supabase.from("vw_tarefas").select("*").eq("responsavel_id", userId).eq("concluida", false)
        .order("prazo", { ascending: true, nullsFirst: false }).order("criado_em"),
      supabase.from("vw_tarefas").select("*").eq("criado_por", userId).neq("responsavel_id", userId).eq("concluida", false)
        .order("prazo", { ascending: true, nullsFirst: false }),
      supabase.from("vw_tarefas").select("*").eq("responsavel_id", userId).eq("concluida", true).gte("concluida_em", trintaDias)
        .order("concluida_em", { ascending: false }),
      supabase.from("projetos").select("*"),
    ]);
    if (a.error) setErro(a.error.message);
    setTarefas((a.data ?? []) as Tarefa[]);
    setDelegadas((b.data ?? []) as Tarefa[]);
    setConcluidas((c.data ?? []) as Tarefa[]);
    setProjetos(Object.fromEntries(((p.data ?? []) as Projeto[]).map((x) => [x.id, x])));
  }, [supabase, userId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function toggle(t: Tarefa) {
    const lista = (l: Tarefa[]) => l.map((x) => (x.id === t.id ? { ...x, concluida: !x.concluida } : x));
    setTarefas(lista); setDelegadas(lista); setConcluidas(lista);   // resposta imediata
    await supabase.from("tarefas").update({ concluida: !t.concluida }).eq("id", t.id);
    setTimeout(carregar, 600);
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;
    const { error } = await supabase.from("tarefas").insert({
      titulo: novo.trim(), responsavel_id: userId, prazo: novoPrazo || null, ordem: Date.now(),
    });
    if (error) { setErro(error.message); return; }
    setNovo(""); setNovoPrazo(""); carregar();
  }

  async function mudarPrazo(id: string, prazo: string | null) {
    setTarefas((l) => l.map((x) => (x.id === id ? { ...x, prazo } : x)));
    await supabase.from("tarefas").update({ prazo }).eq("id", id);
    carregar();
  }

  const grupos = useMemo(
    () => FAIXAS.map((f) => ({ ...f, itens: tarefas.filter((t) => faixaDoPrazo(t.prazo) === f.key) })).filter((g) => g.itens.length > 0),
    [tarefas],
  );
  const nAtrasadas = tarefas.filter((t) => t.prazo && t.prazo < hojeISO()).length;

  const linha = (t: Tarefa) => (
    <TarefaLinha key={t.id} t={t} pessoa={t.responsavel_id ? porId[t.responsavel_id] : null}
      projetoNome={t.projeto_id ? projetos[t.projeto_id]?.nome : null}
      onAbrir={() => setAberta(t.id)} onToggle={() => toggle(t)} />
  );

  return (
    <div className={`mx-auto space-y-5 ${aba === "calendario" ? "max-w-6xl" : "max-w-4xl"}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">✅ Minhas tarefas</h1>
          <p className="text-sm text-gray-500">
            {tarefas.length} aberta(s){nAtrasadas > 0 && <span className="text-red-600"> · {nAtrasadas} atrasada(s)</span>}
          </p>
        </div>
        <Link href="/tarefas/projetos" className="btn-ghost text-sm ring-1 ring-gray-200">📁 Projetos</Link>
      </div>

      <div className="abas-rolaveis flex gap-1 border-b">
        {([["proximas", `Próximas (${tarefas.length})`], ["calendario", "📅 Calendário"], ["delegadas", `Delegadas (${delegadas.length})`], ["concluidas", "Concluídas"]] as [Aba, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
            {l}
          </button>
        ))}
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {aba === "proximas" && (
        <>
          <form onSubmit={criar} className="card flex flex-wrap items-center gap-2 p-2">
            <span className="pl-2 text-gray-300">+</span>
            <input className="min-w-[200px] flex-1 border-0 p-1.5 text-sm focus:ring-0" placeholder="Nova tarefa para mim… (Enter)"
              value={novo} onChange={(e) => setNovo(e.target.value)} />
            <input type="date" className="inp w-40 py-1 text-sm" value={novoPrazo} onChange={(e) => setNovoPrazo(e.target.value)} title="Prazo" />
            <button className="btn-primary text-sm" disabled={!novo.trim()}>Adicionar</button>
          </form>
          {grupos.length === 0 ? (
            <div className="card p-10 text-center text-sm text-gray-400">Nada pendente com você. 🎉</div>
          ) : grupos.map((g) => (
            <section key={g.key}>
              <h2 className={`mb-1 text-xs font-semibold uppercase tracking-wide ${g.key === "atrasadas" ? "text-red-600" : "text-gray-500"}`}>
                {g.label} · {g.itens.length}
              </h2>
              <div className="card overflow-hidden">{g.itens.map(linha)}</div>
            </section>
          ))}
        </>
      )}

      {aba === "calendario" && (
        <CalendarioTarefas tarefas={[...tarefas, ...concluidas]} porId={porId} onAbrir={setAberta} onMudarPrazo={mudarPrazo} />
      )}

      {aba === "delegadas" && (
        delegadas.length === 0
          ? <div className="card p-10 text-center text-sm text-gray-400">Nenhuma tarefa que você criou para outra pessoa está aberta.</div>
          : <div className="card overflow-hidden">{delegadas.map(linha)}</div>
      )}

      {aba === "concluidas" && (
        concluidas.length === 0
          ? <div className="card p-10 text-center text-sm text-gray-400">Nenhuma tarefa concluída nos últimos 30 dias.</div>
          : <div className="card overflow-hidden">{concluidas.map(linha)}</div>
      )}

      {aberta && <TarefaDrawer tarefaId={aberta} onClose={() => setAberta(null)} onChange={carregar} />}
    </div>
  );
}
