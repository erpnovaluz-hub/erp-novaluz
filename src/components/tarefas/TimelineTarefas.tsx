"use client";

import { useMemo, useRef, useState } from "react";
import { hojeISO, type Pessoa, type Secao, type Tarefa } from "@/lib/tarefas";
import { Avatar } from "@/components/tarefas/comum";

const DIA_PX = 28;
const LINHA_PX = 34;
const SEMANAS = 8;

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const deISO = (s: string) => new Date(s + "T00:00:00");
const somar = (s: string, n: number) => { const d = deISO(s); d.setDate(d.getDate() + n); return toISO(d); };
const diff = (a: string, b: string) => Math.round((deISO(a).getTime() - deISO(b).getTime()) / 86400000);

type Arrasto = { id: string; modo: "mover" | "inicio" | "fim"; x0: number; dias: number };

// Gantt simples: barra de início→prazo, agrupada por seção.
// Arraste a barra para mover as duas datas; as pontas mudam só início ou prazo.
export default function TimelineTarefas({ tarefas, secoes, porId, onAbrir, onDatas }: {
  tarefas: Tarefa[]; secoes: { id: string; nome: string }[]; porId: Record<string, Pessoa>;
  onAbrir: (id: string) => void; onDatas: (id: string, inicio: string | null, prazo: string | null) => void;
}) {
  const hoje = hojeISO();
  const [inicioJanela, setInicioJanela] = useState(() => {
    const d = deISO(hoje); d.setDate(d.getDate() - 7 - ((d.getDay() + 6) % 7));   // segunda da semana passada
    return toISO(d);
  });
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const arrastou = useRef(false);

  const dias = useMemo(() => Array.from({ length: SEMANAS * 7 }, (_, i) => somar(inicioJanela, i)), [inicioJanela]);
  const fimJanela = dias[dias.length - 1];

  const comData = tarefas.filter((t) => t.prazo || t.inicio);
  const semData = tarefas.filter((t) => !t.prazo && !t.inicio);
  const grupos = secoes
    .map((s) => ({ ...s, itens: comData.filter((t) => (s.id === "__sem__" ? !secoes.some((x) => x.id === t.secao_id) : t.secao_id === s.id)) }))
    .filter((g) => g.itens.length > 0);

  // datas da barra, já considerando o arrasto em andamento
  function datas(t: Tarefa): [string, string] {
    let ini = t.inicio ?? t.prazo!, fim = t.prazo ?? t.inicio!;
    if (arrasto?.id === t.id && arrasto.dias !== 0) {
      if (arrasto.modo !== "fim") ini = somar(ini, arrasto.dias);
      if (arrasto.modo !== "inicio") fim = somar(fim, arrasto.dias);
      if (ini > fim) arrasto.modo === "inicio" ? (ini = fim) : (fim = ini);
    }
    return [ini, fim];
  }

  function comecar(e: React.PointerEvent, t: Tarefa, modo: Arrasto["modo"]) {
    e.stopPropagation(); e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    arrastou.current = false;
    setArrasto({ id: t.id, modo, x0: e.clientX, dias: 0 });
  }
  function mover(e: React.PointerEvent) {
    if (!arrasto) return;
    const d = Math.round((e.clientX - arrasto.x0) / DIA_PX);
    if (d !== arrasto.dias) { arrastou.current = true; setArrasto({ ...arrasto, dias: d }); }
  }
  function soltar(t: Tarefa) {
    if (!arrasto) return;
    const [ini, fim] = datas(t);
    const mudou = arrasto.dias !== 0;
    setArrasto(null);
    if (!mudou) return;
    // tarefa só com prazo continua só com prazo quando é movida inteira
    onDatas(t.id, t.inicio || arrasto.modo === "inicio" ? ini : null, fim);
  }

  const mesLabel = (iso: string) => deISO(iso).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className="btn-ghost px-2" onClick={() => setInicioJanela((s) => somar(s, -28))} aria-label="Voltar 4 semanas">‹</button>
        <button className="btn-ghost px-2" onClick={() => setInicioJanela((s) => somar(s, 28))} aria-label="Avançar 4 semanas">›</button>
        <span className="text-sm font-medium capitalize text-gray-700">
          {deISO(inicioJanela).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – {deISO(fimJanela).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
        <button className="btn-ghost ml-auto text-sm ring-1 ring-gray-200" onClick={() => {
          const d = deISO(hoje); d.setDate(d.getDate() - 7 - ((d.getDay() + 6) % 7)); setInicioJanela(toISO(d));
        }}>Hoje</button>
      </div>

      <div className="card overflow-x-auto">
        <div className="relative" style={{ width: 240 + dias.length * DIA_PX }}>
          {/* cabeçalho de dias */}
          <div className="sticky top-0 z-10 flex border-b bg-gray-50 text-[10px] text-gray-500">
            <div className="sticky left-0 z-20 w-[240px] shrink-0 border-r bg-gray-50 px-3 py-1 font-medium uppercase">Tarefa</div>
            {dias.map((d) => {
              const dt = deISO(d);
              const fds = dt.getDay() === 0 || dt.getDay() === 6;
              return (
                <div key={d} className={`shrink-0 border-r border-gray-100 py-1 text-center ${fds ? "bg-gray-100" : ""} ${d === hoje ? "font-bold text-brand-700" : ""}`} style={{ width: DIA_PX }}>
                  {dt.getDate() === 1 || d === dias[0] ? <span className="block capitalize">{mesLabel(d)}</span> : <span className="block">&nbsp;</span>}
                  {dt.getDate()}
                </div>
              );
            })}
          </div>

          {/* linhas */}
          {grupos.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-gray-400">Nenhuma tarefa com data. Defina início/prazo no painel da tarefa.</div>
          )}
          {grupos.map((g) => (
            <div key={g.id}>
              <div className="sticky left-0 w-[240px] bg-white px-3 pb-1 pt-3 text-xs font-semibold text-gray-600">{g.nome}</div>
              {g.itens.map((t) => {
                const [ini, fim] = datas(t);
                const x = diff(ini, inicioJanela), w = diff(fim, ini) + 1;
                const visivel = fim >= inicioJanela && ini <= fimJanela;
                const atrasada = !t.concluida && t.prazo && t.prazo < hoje;
                const cor = t.concluida ? "bg-gray-300 text-gray-600" : atrasada ? "bg-red-500 text-white" : "bg-brand-600 text-white";
                return (
                  <div key={t.id} className="relative flex border-b border-gray-50" style={{ height: LINHA_PX }}>
                    <button onClick={() => onAbrir(t.id)}
                      className="sticky left-0 z-10 flex w-[240px] shrink-0 items-center gap-2 border-r bg-white px-3 text-left text-sm hover:bg-gray-50">
                      <Avatar pessoa={t.responsavel_id ? porId[t.responsavel_id] : null} size={18} />
                      <span className={`truncate ${t.concluida ? "text-gray-400 line-through" : "text-gray-800"}`}>{t.titulo}</span>
                    </button>
                    {/* fundo: fins de semana + hoje */}
                    {dias.map((d, i) => {
                      const dd = deISO(d).getDay();
                      return (dd === 0 || dd === 6 || d === hoje) ? (
                        <div key={d} className={`absolute top-0 h-full ${d === hoje ? "border-l-2 border-brand-400" : "bg-gray-50"}`}
                          style={{ left: 240 + i * DIA_PX, width: d === hoje ? 0 : DIA_PX }} />
                      ) : null;
                    })}
                    {visivel && (
                      <div
                        onPointerDown={(e) => comecar(e, t, "mover")} onPointerMove={mover} onPointerUp={() => soltar(t)}
                        onClick={() => { if (!arrastou.current) onAbrir(t.id); }}
                        title={`${t.titulo}\n${deISO(ini).toLocaleDateString("pt-BR")} → ${deISO(fim).toLocaleDateString("pt-BR")}`}
                        className={`group absolute top-1.5 flex cursor-grab items-center overflow-hidden rounded px-2 text-[11px] shadow-sm active:cursor-grabbing ${cor}`}
                        style={{ left: 240 + Math.max(0, x) * DIA_PX + 2, width: Math.max(1, Math.min(w + Math.min(0, x), dias.length - Math.max(0, x))) * DIA_PX - 4, height: LINHA_PX - 12 }}>
                        <span className="pointer-events-none truncate">{w > 2 ? t.titulo : ""}</span>
                        <span onPointerDown={(e) => comecar(e, t, "inicio")} onPointerMove={mover} onPointerUp={() => soltar(t)}
                          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:bg-black/20 group-hover:opacity-100" />
                        <span onPointerDown={(e) => comecar(e, t, "fim")} onPointerMove={mover} onPointerUp={() => soltar(t)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize opacity-0 group-hover:bg-black/20 group-hover:opacity-100" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded bg-brand-600" /> no prazo</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded bg-red-500" /> atrasada</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded bg-gray-300" /> concluída</span>
        <span>Arraste a barra para mover · puxe as pontas para mudar início ou prazo</span>
        {semData.length > 0 && <span className="ml-auto">{semData.length} tarefa(s) sem data não aparecem aqui</span>}
      </div>
    </div>
  );
}
