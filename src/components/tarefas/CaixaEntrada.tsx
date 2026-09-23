"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { formatDateTime } from "@/lib/format";
import { corPrazo, hojeISO, rotuloPrazo, type Tarefa } from "@/lib/tarefas";
import { Avatar, useEquipe } from "@/components/tarefas/comum";
import TarefaDrawer from "@/components/tarefas/TarefaDrawer";

type Notificacao = {
  id: string; ator_id: string | null; tipo: "atribuida" | "mencao" | "comentario" | "concluida";
  tarefa_id: string | null; texto: string | null; lida: boolean; criado_em: string;
  tarefas: { titulo: string } | null;
};

const ACAO: Record<Notificacao["tipo"], string> = {
  atribuida: "atribuiu a você",
  mencao: "mencionou você em",
  comentario: "comentou em",
  concluida: "concluiu",
};

// avisa o menu para recontar as não lidas
export function avisarMenu() {
  window.dispatchEvent(new Event("notificacoes"));
}

function quando(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.round(min / 60)} h`;
  return formatDateTime(iso);
}

export default function CaixaEntrada() {
  const supabase = useMemo(() => createClient(), []);
  const { userId } = useAcesso();
  const { porId } = useEquipe();
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [prazos, setPrazos] = useState<Tarefa[]>([]);
  const [soNaoLidas, setSoNaoLidas] = useState(true);
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!userId) return;
    let q = supabase.from("notificacoes").select("*, tarefas(titulo)").order("criado_em", { ascending: false }).limit(100);
    if (soNaoLidas) q = q.eq("lida", false);
    const amanha = new Date(Date.now() + 86400000);
    const ate = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, "0")}-${String(amanha.getDate()).padStart(2, "0")}`;
    const [n, p] = await Promise.all([
      q,
      supabase.from("tarefas").select("*").eq("responsavel_id", userId).eq("concluida", false).lte("prazo", ate).order("prazo"),
    ]);
    setItens((n.data ?? []) as Notificacao[]);
    setPrazos((p.data ?? []) as Tarefa[]);
  }, [supabase, userId, soNaoLidas]);

  useEffect(() => { carregar(); }, [carregar]);

  async function abrir(n: Notificacao) {
    if (!n.lida) {
      setItens((l) => l.map((x) => (x.id === n.id ? { ...x, lida: true } : x)));
      await supabase.from("notificacoes").update({ lida: true }).eq("id", n.id);
      avisarMenu();
    }
    if (n.tarefa_id) setAberta(n.tarefa_id);
  }

  async function marcarTodas() {
    await supabase.from("notificacoes").update({ lida: true }).eq("lida", false);
    avisarMenu(); carregar();
  }

  async function limparLidas() {
    if (!confirm("Apagar todas as notificações já lidas?")) return;
    await supabase.from("notificacoes").delete().eq("lida", true);
    carregar();
  }

  const hoje = hojeISO();
  const naoLidas = itens.filter((n) => !n.lida).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">🔔 Caixa de entrada</h1>
          <p className="text-sm text-gray-500">Atribuições, menções e comentários nas suas tarefas</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {naoLidas > 0 && <button className="btn-ghost ring-1 ring-gray-200" onClick={marcarTodas}>✓ Marcar todas como lidas</button>}
          {!soNaoLidas && <button className="btn-ghost text-gray-500" onClick={limparLidas}>Limpar lidas</button>}
        </div>
      </div>

      {prazos.length > 0 && (
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">⏰ Prazos · vencidas, hoje e amanhã</h2>
          <div className="card divide-y overflow-hidden">
            {prazos.map((t) => (
              <button key={t.id} onClick={() => setAberta(t.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-gray-50">
                <span>{t.prazo! < hoje ? "🔴" : "🟡"}</span>
                <span className="flex-1 truncate text-gray-800">{t.titulo}</span>
                <span className={`text-xs ${corPrazo(t.prazo, false)}`}>{rotuloPrazo(t.prazo)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-1 flex gap-1 border-b">
          {([[true, "Não lidas"], [false, "Todas"]] as [boolean, string][]).map(([v, l]) => (
            <button key={l} onClick={() => setSoNaoLidas(v)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${soNaoLidas === v ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {l}
            </button>
          ))}
        </div>
        {itens.length === 0 ? (
          <div className="card mt-3 p-10 text-center text-sm text-gray-400">{soNaoLidas ? "Tudo em dia. Nenhuma notificação nova. 🎉" : "Nenhuma notificação."}</div>
        ) : (
          <div className="card mt-3 divide-y overflow-hidden">
            {itens.map((n) => {
              const ator = n.ator_id ? porId[n.ator_id] : null;
              return (
                <button key={n.id} onClick={() => abrir(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-gray-50 ${n.lida ? "" : "bg-brand-50/40"}`}>
                  <Avatar pessoa={ator} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-700">
                      <b>{ator?.nome || ator?.email || "Alguém"}</b> {ACAO[n.tipo]}{" "}
                      <b className="text-gray-900">{n.tarefas?.titulo ?? "uma tarefa"}</b>
                    </p>
                    {(n.tipo === "mencao" || n.tipo === "comentario") && n.texto && (
                      <p className="mt-0.5 truncate text-gray-500">“{n.texto}”</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-gray-400">{quando(n.criado_em)}</p>
                  </div>
                  {!n.lida && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="não lida" />}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {aberta && <TarefaDrawer tarefaId={aberta} onClose={() => setAberta(null)} onChange={carregar} />}
    </div>
  );
}
