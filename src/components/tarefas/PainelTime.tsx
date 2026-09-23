"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CORES, hojeISO, rotuloPrazo, type Pessoa, type Projeto, type Tarefa } from "@/lib/tarefas";
import { Avatar, useEquipe } from "@/components/tarefas/comum";
import TarefaLinha from "@/components/tarefas/TarefaLinha";
import TarefaDrawer from "@/components/tarefas/TarefaDrawer";

type Aba = "produtividade" | "carga" | "portfolio";
const BRAND = "#1d4ed8";   // brand-600

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const somar = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return toISO(d); };
const segunda = (s: string) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISO(d); };
const diasEntre = (a: string, b: string) => (new Date(a).getTime() - new Date(b).getTime()) / 86400000;

// Painel da gerência: produtividade, carga por pessoa e portfólio de projetos.
// Considera só tarefas principais (subtarefas ficam de fora das contas).
export default function PainelTime() {
  const supabase = useMemo(() => createClient(), []);
  const { pessoas, porId } = useEquipe();
  const [aba, setAba] = useState<Aba>("produtividade");
  const [periodo, setPeriodo] = useState(30);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const hoje = hojeISO();
  const desde = somar(hoje, -periodo);

  const carregar = useCallback(async () => {
    const [t, p] = await Promise.all([
      supabase.from("tarefas").select("*").is("parent_id", null)
        .or(`concluida.eq.false,concluida_em.gte.${desde}`).range(0, 9999),
      supabase.from("projetos").select("*").eq("arquivado", false).order("nome"),
    ]);
    if (t.error) setErro(t.error.message);
    setTarefas((t.data ?? []) as Tarefa[]);
    setProjetos((p.data ?? []) as Projeto[]);
  }, [supabase, desde]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📊 Painel do time</h1>
          <p className="text-sm text-gray-500">Entregas, carga de trabalho e andamento dos projetos · fonte: tarefas</p>
        </div>
        <Link href="/tarefas/projetos" className="btn-ghost text-sm ring-1 ring-gray-200">📁 Projetos</Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b">
        <div className="flex gap-1">
          {([["produtividade", "Produtividade"], ["carga", "Carga de trabalho"], ["portfolio", "Portfólio de projetos"]] as [Aba, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${aba === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>{l}</button>
          ))}
        </div>
        {aba === "produtividade" && (
          <select className="inp mb-1 w-40 py-1 text-sm" value={periodo} onChange={(e) => setPeriodo(Number(e.target.value))}>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={180}>Últimos 180 dias</option>
          </select>
        )}
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {aba === "produtividade" && <Produtividade tarefas={tarefas} pessoas={pessoas} desde={desde} hoje={hoje} periodo={periodo} />}
      {aba === "carga" && <Carga tarefas={tarefas} pessoas={pessoas} porId={porId} hoje={hoje} onAbrir={setAberta} />}
      {aba === "portfolio" && <Portfolio tarefas={tarefas} projetos={projetos} porId={porId} hoje={hoje} />}

      {aberta && <TarefaDrawer tarefaId={aberta} onClose={() => setAberta(null)} onChange={carregar} />}
    </div>
  );
}

// ---- Produtividade ---------------------------------------------------------------
function Produtividade({ tarefas, pessoas, desde, hoje, periodo }: {
  tarefas: Tarefa[]; pessoas: Pessoa[]; desde: string; hoje: string; periodo: number;
}) {
  const concl = tarefas.filter((t) => t.concluida && t.concluida_em && t.concluida_em.slice(0, 10) >= desde);
  const comPrazo = concl.filter((t) => t.prazo);
  const noPrazo = comPrazo.filter((t) => t.concluida_em!.slice(0, 10) <= t.prazo!);
  const abertas = tarefas.filter((t) => !t.concluida);
  const atrasadas = abertas.filter((t) => t.prazo && t.prazo < hoje);
  const tempoMedio = concl.length ? concl.reduce((s, t) => s + diasEntre(t.concluida_em!, t.criado_em), 0) / concl.length : null;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  const porPessoa = pessoas.map((p) => {
    const c = concl.filter((t) => t.responsavel_id === p.id);
    const cp = c.filter((t) => t.prazo);
    const np = cp.filter((t) => t.concluida_em!.slice(0, 10) <= t.prazo!);
    const ab = abertas.filter((t) => t.responsavel_id === p.id);
    return {
      p, concluidas: c.length, noPrazo: pct(np.length, cp.length),
      abertas: ab.length, atrasadas: ab.filter((t) => t.prazo && t.prazo < hoje).length,
      tempo: c.length ? c.reduce((s, t) => s + diasEntre(t.concluida_em!, t.criado_em), 0) / c.length : null,
    };
  }).sort((a, b) => b.concluidas - a.concluidas || b.abertas - a.abertas);
  const maxConcl = Math.max(1, ...porPessoa.map((x) => x.concluidas));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi titulo={`Concluídas (${periodo} dias)`} valor={String(concl.length)} />
        <Kpi titulo="Entregues no prazo" valor={pct(noPrazo.length, comPrazo.length)} sub={comPrazo.length ? `${noPrazo.length} de ${comPrazo.length} com prazo` : "sem prazos no período"} />
        <Kpi titulo="Tempo médio p/ concluir" valor={tempoMedio == null ? "—" : `${tempoMedio.toFixed(1)} d`} sub="da criação à conclusão" />
        <Kpi titulo="Abertas agora" valor={String(abertas.length)} />
        <Kpi titulo="Atrasadas agora" valor={String(atrasadas.length)} alerta={atrasadas.length > 0} />
      </div>

      <section className="card p-4">
        <h2 className="text-sm font-semibold text-gray-700">Tarefas concluídas por semana</h2>
        <p className="mb-3 text-xs text-gray-400">Semanas começando na segunda-feira</p>
        <GraficoSemanas concl={concl} desde={desde} hoje={hoje} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Por pessoa</h2>
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Pessoa</th>
                <th className="px-4 py-2">Concluídas</th>
                <th className="px-4 py-2 text-right">No prazo</th>
                <th className="px-4 py-2 text-right">Tempo médio</th>
                <th className="px-4 py-2 text-right">Abertas</th>
                <th className="px-4 py-2 text-right">Atrasadas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {porPessoa.map((x) => (
                <tr key={x.p.id}>
                  <td className="px-4 py-2"><span className="flex items-center gap-2"><Avatar pessoa={x.p} size={22} /> {x.p.nome || x.p.email}</span></td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="h-2 rounded-r" style={{ width: `${(x.concluidas / maxConcl) * 120}px`, background: BRAND, minWidth: x.concluidas ? 3 : 0 }} />
                      <span className="tabular-nums text-gray-800">{x.concluidas}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{x.noPrazo}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{x.tempo == null ? "—" : `${x.tempo.toFixed(1)} d`}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{x.abertas}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${x.atrasadas ? "font-medium text-red-600" : "text-gray-400"}`}>{x.atrasadas ? `⚠ ${x.atrasadas}` : "0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function GraficoSemanas({ concl, desde, hoje }: { concl: Tarefa[]; desde: string; hoje: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const semanas: { ini: string; n: number }[] = [];
  for (let s = segunda(desde); s <= hoje; s = somar(s, 7)) semanas.push({ ini: s, n: 0 });
  for (const t of concl) {
    const s = segunda(t.concluida_em!.slice(0, 10));
    const w = semanas.find((x) => x.ini === s);
    if (w) w.n++;
  }
  const max = Math.max(1, ...semanas.map((s) => s.n));
  const topo = Math.max(4, Math.ceil(max / 4) * 4);   // eixo em múltiplos de 4
  const W = 720, H = 200, ML = 32, MB = 22, MT = 8;
  const band = (W - ML) / semanas.length;
  const bw = Math.min(28, band * 0.6);
  const y = (v: number) => MT + (H - MT - MB) * (1 - v / topo);
  const rotulo = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  if (concl.length === 0) return <p className="py-10 text-center text-sm text-gray-400">Nenhuma tarefa concluída no período.</p>;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Tarefas concluídas por semana">
        {[0, topo / 2, topo].map((v) => (
          <g key={v}>
            <line x1={ML} x2={W} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#9ca3af">{v}</text>
          </g>
        ))}
        {semanas.map((s, i) => {
          const x = ML + i * band + (band - bw) / 2;
          const h = y(0) - y(s.n);
          return (
            <g key={s.ini} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* alvo de hover maior que a barra */}
              <rect x={ML + i * band} y={MT} width={band} height={H - MT - MB} fill={hover === i ? "#f3f4f6" : "transparent"} />
              {s.n > 0 && (
                <path fill={BRAND}
                  d={`M${x},${y(0)} V${y(s.n) + Math.min(4, h)} Q${x},${y(s.n)} ${x + Math.min(4, bw / 2)},${y(s.n)} H${x + bw - Math.min(4, bw / 2)} Q${x + bw},${y(s.n)} ${x + bw},${y(s.n) + Math.min(4, h)} V${y(0)} Z`} />
              )}
              {(semanas.length <= 14 || i % 2 === 0) && (
                <text x={ML + i * band + band / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#6b7280">{rotulo(s.ini)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-0 rounded-md border bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${((ML + hover * band + band / 2) / W) * 100}%`, transform: "translateX(-50%)" }}>
          <p className="text-gray-500">Semana de {rotulo(semanas[hover].ini)}</p>
          <p className="font-semibold text-gray-900">{semanas[hover].n} concluída(s)</p>
        </div>
      )}
    </div>
  );
}

// ---- Carga de trabalho --------------------------------------------------------------
const FAIXAS_CARGA = ["atrasadas", "s0", "s1", "s2", "s3", "sem"] as const;
type FaixaCarga = (typeof FAIXAS_CARGA)[number];

function Carga({ tarefas, pessoas, porId, hoje, onAbrir }: {
  tarefas: Tarefa[]; pessoas: Pessoa[]; porId: Record<string, Pessoa>; hoje: string; onAbrir: (id: string) => void;
}) {
  const [sel, setSel] = useState<{ pessoa: string; faixa: FaixaCarga } | null>(null);
  const seg = segunda(hoje);
  const abertas = tarefas.filter((t) => !t.concluida);

  const faixa = (t: Tarefa): FaixaCarga | null => {
    if (!t.prazo) return "sem";
    if (t.prazo < hoje) return "atrasadas";
    const k = Math.floor((new Date(t.prazo + "T00:00:00").getTime() - new Date(seg + "T00:00:00").getTime()) / (7 * 86400000));
    return k <= 3 ? (`s${k}` as FaixaCarga) : null;   // depois de 4 semanas não entra na grade
  };
  const titulo: Record<FaixaCarga, string> = {
    atrasadas: "Atrasadas", s0: "Esta semana", s1: "Próx. semana",
    s2: `Sem. ${new Date(somar(seg, 14) + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`,
    s3: `Sem. ${new Date(somar(seg, 21) + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`,
    sem: "Sem prazo",
  };

  const linhas = [...pessoas.map((p) => ({ id: p.id, pessoa: p as Pessoa | null })), { id: "ninguem", pessoa: null }]
    .map((l) => {
      const minhas = abertas.filter((t) => (l.id === "ninguem" ? !t.responsavel_id : t.responsavel_id === l.id));
      const cont = Object.fromEntries(FAIXAS_CARGA.map((f) => [f, minhas.filter((t) => faixa(t) === f)])) as Record<FaixaCarga, Tarefa[]>;
      return { ...l, total: minhas.length, cont };
    })
    .filter((l) => l.id !== "ninguem" || l.total > 0)
    .sort((a, b) => b.total - a.total);

  // escala sequencial de um só tom (azul da marca); número sempre escrito na célula
  const tom = (n: number, f: FaixaCarga) => {
    if (n === 0) return "bg-white text-gray-300";
    if (f === "atrasadas") return "bg-red-50 text-red-700 font-semibold";
    if (n <= 2) return "bg-brand-50 text-gray-800";
    if (n <= 5) return "bg-brand-100 text-gray-900";
    if (n <= 9) return "bg-brand-500 text-white";
    return "bg-brand-700 text-white font-semibold";
  };

  const lista = sel ? linhas.find((l) => l.id === sel.pessoa)?.cont[sel.faixa] ?? [] : [];

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Pessoa</th>
              {FAIXAS_CARGA.map((f) => <th key={f} className="px-2 py-2 text-center">{titulo[f]}</th>)}
              <th className="px-4 py-2 text-right">Total aberto</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2"><Avatar pessoa={l.pessoa} size={22} /> {l.pessoa ? (l.pessoa.nome || l.pessoa.email) : <i className="text-gray-500">Sem responsável</i>}</span>
                </td>
                {FAIXAS_CARGA.map((f) => {
                  const n = l.cont[f].length;
                  const ativo = sel?.pessoa === l.id && sel.faixa === f;
                  return (
                    <td key={f} className="p-1">
                      <button disabled={n === 0} onClick={() => setSel(ativo ? null : { pessoa: l.id, faixa: f })}
                        title={`${l.pessoa?.nome ?? "Sem responsável"} · ${titulo[f]}: ${n} tarefa(s)`}
                        className={`h-9 w-full min-w-[56px] rounded-md tabular-nums transition ${tom(n, f)} ${ativo ? "ring-2 ring-gray-900" : n ? "hover:ring-2 hover:ring-brand-300" : ""}`}>
                        {n}
                      </button>
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-right font-medium tabular-nums">{l.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Clique num número para ver as tarefas. Tarefas com prazo depois de 4 semanas entram só no total.</p>

      {sel && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-gray-700">
            {porId[sel.pessoa]?.nome ?? "Sem responsável"} · {titulo[sel.faixa]} · {lista.length}
          </h2>
          <div className="card overflow-hidden">
            {lista.map((t) => (
              <TarefaLinha key={t.id} t={t} pessoa={t.responsavel_id ? porId[t.responsavel_id] : null} onAbrir={() => onAbrir(t.id)} onToggle={() => onAbrir(t.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---- Portfólio --------------------------------------------------------------------
function Portfolio({ tarefas, projetos, porId, hoje }: {
  tarefas: Tarefa[]; projetos: Projeto[]; porId: Record<string, Pessoa>; hoje: string;
}) {
  // aqui precisamos do total do projeto (inclui concluídas antigas): busca à parte
  const supabase = useMemo(() => createClient(), []);
  const [todas, setTodas] = useState<{ projeto_id: string; concluida: boolean }[]>([]);
  useEffect(() => {
    supabase.from("tarefas").select("projeto_id, concluida").is("parent_id", null).not("projeto_id", "is", null).range(0, 19999)
      .then(({ data }) => setTodas((data ?? []) as any));
  }, [supabase]);

  const linhas = projetos.map((p) => {
    const tot = todas.filter((t) => t.projeto_id === p.id);
    const ok = tot.filter((t) => t.concluida).length;
    const abertas = tarefas.filter((t) => t.projeto_id === p.id && !t.concluida);
    const atrasadas = abertas.filter((t) => t.prazo && t.prazo < hoje).length;
    const proximo = abertas.filter((t) => t.prazo && t.prazo >= hoje).map((t) => t.prazo!).sort()[0] ?? null;
    const pct = tot.length ? Math.round((ok / tot.length) * 100) : 0;
    const saude = atrasadas === 0 ? { t: "Em dia", c: "bg-green-100 text-green-700", i: "●" }
      : atrasadas <= 2 ? { t: "Atenção", c: "bg-amber-100 text-amber-800", i: "▲" }
      : { t: "Atrasado", c: "bg-red-100 text-red-700", i: "■" };
    return { p, total: tot.length, ok, pct, abertas: abertas.length, atrasadas, proximo, saude };
  }).sort((a, b) => b.atrasadas - a.atrasadas || a.pct - b.pct);

  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2">Projeto</th>
            <th className="px-4 py-2">Situação</th>
            <th className="px-4 py-2">Progresso</th>
            <th className="px-4 py-2 text-right">Abertas</th>
            <th className="px-4 py-2 text-right">Atrasadas</th>
            <th className="px-4 py-2">Próximo prazo</th>
            <th className="px-4 py-2">Dono</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {linhas.length === 0 ? (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Nenhum projeto ativo.</td></tr>
          ) : linhas.map((l) => (
            <tr key={l.p.id} className="hover:bg-gray-50">
              <td className="px-4 py-2">
                <Link href={`/tarefas/projetos/${l.p.id}`} className="flex items-center gap-2 font-medium text-gray-800 hover:underline">
                  <span className="h-3 w-3 rounded-sm" style={{ background: CORES[l.p.cor] ?? CORES.teal }} />
                  {l.p.privado && "🔒 "}{l.p.nome}
                </Link>
              </td>
              <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.saude.c}`}>{l.saude.i} {l.saude.t}</span></td>
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-28 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-2 rounded-full" style={{ width: `${l.pct}%`, background: BRAND }} />
                  </span>
                  <span className="text-xs tabular-nums text-gray-600">{l.pct}% · {l.ok}/{l.total}</span>
                </span>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{l.abertas}</td>
              <td className={`px-4 py-2 text-right tabular-nums ${l.atrasadas ? "font-medium text-red-600" : "text-gray-400"}`}>{l.atrasadas}</td>
              <td className="px-4 py-2 text-gray-600">{l.proximo ? rotuloPrazo(l.proximo) : "—"}</td>
              <td className="px-4 py-2"><Avatar pessoa={l.p.dono_id ? porId[l.p.dono_id] : null} size={22} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ titulo, valor, sub, alerta }: { titulo: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alerta ? "text-red-600" : "text-gray-900"}`}>{alerta && "⚠ "}{valor}</p>
      {sub && <p className="mt-1 text-[11px] text-gray-400">{sub}</p>}
    </div>
  );
}
