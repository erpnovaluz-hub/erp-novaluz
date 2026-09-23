"use client";

import { useMemo, useState } from "react";
import { hojeISO, type Pessoa, type Tarefa } from "@/lib/tarefas";
import { Avatar } from "@/components/tarefas/comum";

const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Mês em grade (segunda a domingo). Arraste a tarefa para outro dia para mudar o prazo;
// "Sem prazo" fica ao lado e também pode ser arrastada para o calendário.
export default function CalendarioTarefas({ tarefas, porId, onAbrir, onMudarPrazo }: {
  tarefas: Tarefa[]; porId: Record<string, Pessoa>;
  onAbrir: (id: string) => void; onMudarPrazo: (id: string, prazo: string | null) => void;
}) {
  const [ref, setRef] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sobre, setSobre] = useState<string | null>(null);
  const hoje = hojeISO();

  const dias = useMemo(() => {
    const inicio = new Date(ref);
    inicio.setDate(1 - ((ref.getDay() + 6) % 7));   // volta até a segunda
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(inicio); d.setDate(inicio.getDate() + i); return d; });
  }, [ref]);

  const porDia = useMemo(() => {
    const m: Record<string, Tarefa[]> = {};
    for (const t of tarefas) if (t.prazo) (m[t.prazo] ??= []).push(t);
    return m;
  }, [tarefas]);
  const semPrazo = tarefas.filter((t) => !t.prazo && !t.concluida);

  const mudarMes = (n: number) => setRef((r) => new Date(r.getFullYear(), r.getMonth() + n, 1));
  const soltar = (e: React.DragEvent, prazo: string | null) => {
    e.preventDefault(); setSobre(null);
    const id = e.dataTransfer.getData("text/tarefa");
    if (id) onMudarPrazo(id, prazo);
  };

  const Chip = ({ t }: { t: Tarefa }) => (
    <div draggable onDragStart={(e) => { e.dataTransfer.setData("text/tarefa", t.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => onAbrir(t.id)} title={t.titulo}
      className={`flex cursor-pointer items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] ${
        t.concluida ? "bg-gray-100 text-gray-400 line-through"
        : t.prazo && t.prazo < hoje ? "bg-red-50 text-red-700 hover:bg-red-100"
        : t.prioridade === "urgente" || t.prioridade === "alta" ? "bg-orange-50 text-orange-800 hover:bg-orange-100"
        : "bg-brand-50 text-brand-800 hover:bg-brand-100"}`}>
      {t.responsavel_id && <Avatar pessoa={porId[t.responsavel_id]} size={14} />}
      <span className="truncate">{t.titulo}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <button className="btn-ghost px-2" onClick={() => mudarMes(-1)} aria-label="Mês anterior">‹</button>
          <button className="btn-ghost px-2" onClick={() => mudarMes(1)} aria-label="Próximo mês">›</button>
          <h2 className="text-base font-semibold capitalize text-gray-800">
            {ref.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </h2>
          <button className="btn-ghost ml-auto text-sm ring-1 ring-gray-200"
            onClick={() => { const d = new Date(); setRef(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Hoje</button>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 overflow-hidden rounded-xl border bg-gray-200 text-xs" style={{ gap: 1 }}>
            {DIAS.map((d) => <div key={d} className="bg-gray-50 py-1.5 text-center font-medium uppercase text-gray-500">{d}</div>)}
            {dias.map((d) => {
              const k = iso(d);
              const doMes = d.getMonth() === ref.getMonth();
              const lista = porDia[k] ?? [];
              return (
                <div key={k}
                  onDragOver={(e) => { e.preventDefault(); setSobre(k); }} onDragLeave={() => setSobre(null)} onDrop={(e) => soltar(e, k)}
                  className={`flex min-h-[96px] flex-col gap-0.5 p-1 ${sobre === k ? "bg-brand-50" : doMes ? "bg-white" : "bg-gray-50"}`}>
                  <span className={`mb-0.5 self-end rounded-full px-1.5 text-[11px] ${
                    k === hoje ? "bg-brand-600 font-semibold text-white" : doMes ? "text-gray-600" : "text-gray-300"}`}>
                    {d.getDate()}
                  </span>
                  {lista.slice(0, 4).map((t) => <Chip key={t.id} t={t} />)}
                  {lista.length > 4 && <span className="px-1 text-[10px] text-gray-400">+{lista.length - 4} mais</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside onDragOver={(e) => { e.preventDefault(); setSobre("sem"); }} onDragLeave={() => setSobre(null)} onDrop={(e) => soltar(e, null)}
        className={`w-full shrink-0 rounded-xl border p-2 lg:w-56 ${sobre === "sem" ? "bg-brand-50" : "bg-white"}`}>
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Sem prazo · {semPrazo.length}</p>
        <div className="flex flex-col gap-1">
          {semPrazo.length === 0
            ? <p className="px-1 text-xs text-gray-400">Tudo com prazo definido.</p>
            : semPrazo.map((t) => <Chip key={t.id} t={t} />)}
        </div>
        <p className="mt-3 px-1 text-[10px] text-gray-400">Arraste para um dia para definir o prazo.</p>
      </aside>
    </div>
  );
}
