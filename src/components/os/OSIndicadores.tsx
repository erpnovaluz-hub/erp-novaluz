"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buscarTodos } from "@/lib/supabase/buscarTodos";
import { formatCurrency, formatDate } from "@/lib/format";
import { MOTIVOS_PAUSA, STATUS_OS_ABERTOS, osAtrasada } from "@/lib/os";

type OS = { id: string; numero: string | null; titulo: string; cliente_id: string | null; status: string; prazo: string | null;
  data_realizado: string | null; motivo_pausa: string | null; valor_venda: number | null; faturada_em: string | null };
type Res = { os_id: string; valor_venda: number | null; custo_estimado: number | null; custo_total: number; margem: number | null; margem_pct: number | null };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const IMPLANTACAO = "situação na implantação do histórico";
const rotOS = (o: { numero: string | null }) => o.numero || "s/ nº";
const dias = (a: string, b: string) => Math.round((new Date(a + "T00:00:00").getTime() - new Date(b.slice(0, 10) + "T00:00:00").getTime()) / 86400000);

// Indicadores de OS para a gerência: execução, prazo, faturamento e margem.
export default function OSIndicadores() {
  const supabase = useMemo(() => createClient(), []);
  const [desde, setDesde] = useState(() => iso(new Date(Date.now() - 90 * 86400000)));
  const [ate, setAte] = useState(() => iso(new Date()));
  const [oss, setOss] = useState<OS[]>([]);
  const [res, setRes] = useState<Record<string, Res>>({});
  const [inicio, setInicio] = useState<Record<string, string>>({});
  const [clientes, setClientes] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [marcando, setMarcando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [o, r, h, c] = await Promise.all([
      buscarTodos(supabase.from("ordens_servico").select("id, numero, titulo, cliente_id, status, prazo, data_realizado, motivo_pausa, valor_venda, faturada_em")),
      supabase.rpc("resultados_os"),
      buscarTodos(supabase.from("os_historico").select("id, os_id, para, data, obs").eq("para", "em_andamento")),
      supabase.from("clientes").select("id, nome").range(0, 4999),
    ]);
    setOss((o.data ?? []) as OS[]);
    setRes(Object.fromEntries(((r.data ?? []) as Res[]).map((x) => [x.os_id, x])));
    // 1ª vez que entrou em execução
    const ini: Record<string, string> = {};
    for (const x of (h.data ?? []) as any[]) {
      if (x.obs === IMPLANTACAO) continue;
      if (!ini[x.os_id] || x.data < ini[x.os_id]) ini[x.os_id] = x.data;
    }
    setInicio(ini);
    setClientes(Object.fromEntries(((c.data ?? []) as any[]).map((x) => [x.id, x.nome])));
    setCarregando(false);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  const noPeriodo = (d: string | null) => !!d && d.slice(0, 10) >= desde && d.slice(0, 10) <= ate;
  function atalho(t: "30" | "90" | "mes" | "mesAnt" | "ano") {
    const h = new Date();
    if (t === "30" || t === "90") { setDesde(iso(new Date(Date.now() - Number(t) * 86400000))); setAte(iso(h)); }
    if (t === "mes") { setDesde(iso(new Date(h.getFullYear(), h.getMonth(), 1))); setAte(iso(h)); }
    if (t === "mesAnt") { setDesde(iso(new Date(h.getFullYear(), h.getMonth() - 1, 1))); setAte(iso(new Date(h.getFullYear(), h.getMonth(), 0))); }
    if (t === "ano") { setDesde(iso(new Date(h.getFullYear(), 0, 1))); setAte(iso(h)); }
  }
  const abertas = oss.filter((o) => STATUS_OS_ABERTOS.includes(o.status as any));
  const atrasadas = abertas.filter(osAtrasada);
  const pausadas = oss.filter((o) => o.status === "pausada");
  const concl = oss.filter((o) => (o.status === "concluido" || o.status === "faturada") && noPeriodo(o.data_realizado));
  const comPrazo = concl.filter((o) => o.prazo);
  const noPrazo = comPrazo.filter((o) => o.data_realizado! <= o.prazo!);
  const tempos = concl.filter((o) => inicio[o.id]).map((o) => Math.max(0, dias(o.data_realizado!, inicio[o.id])));
  const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
  const aFaturar = oss.filter((o) => o.status === "concluido")
    .sort((a, b) => (b.data_realizado ?? "").localeCompare(a.data_realizado ?? ""));
  const valorAFaturar = aFaturar.reduce((s, o) => s + Number(o.valor_venda ?? 0), 0);
  const faturadas = oss.filter((o) => noPeriodo(o.faturada_em));
  const faturado = faturadas.reduce((s, o) => s + Number(o.valor_venda ?? 0), 0);
  const comMargem = concl.map((o) => res[o.id]).filter((r) => r && r.margem_pct != null) as Res[];
  const margemMedia = comMargem.length ? comMargem.reduce((s, r) => s + Number(r.margem_pct), 0) / comMargem.length : null;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  const porCliente = useMemo(() => {
    const m = new Map<string, { n: number; venda: number; custo: number }>();
    for (const o of concl) {
      const k = o.cliente_id ?? "—";
      const x = m.get(k) ?? { n: 0, venda: 0, custo: 0 };
      x.n++; x.venda += Number(o.valor_venda ?? 0); x.custo += Number(res[o.id]?.custo_total ?? 0);
      m.set(k, x);
    }
    return Array.from(m.entries()).map(([id, v]) => ({ id, ...v, margem: v.venda - v.custo })).sort((a, b) => b.venda - a.venda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oss, res, desde, ate]);

  const estouradas = abertas.concat(concl)
    .map((o) => ({ o, r: res[o.id] }))
    .filter(({ r }) => r && ((r.custo_estimado && r.custo_total > Number(r.custo_estimado)) || (r.margem != null && r.margem < 0)))
    .sort((a, b) => (a.r!.margem ?? 0) - (b.r!.margem ?? 0)).slice(0, 15);

  // OS antigas que já foram cobradas fora do sistema: vira "faturada" sem gerar título
  async function marcarFaturadas() {
    if (!sel.size) return;
    if (!confirm(`Marcar ${sel.size} OS como já faturada(s) fora do sistema? Nenhum título a receber será criado.`)) return;
    setMarcando(true); setErro(null);
    const { error } = await supabase.from("ordens_servico").update({ status: "faturada" }).in("id", Array.from(sel));
    setMarcando(false);
    if (error) { setErro(error.message); return; }
    setSel(new Set()); carregar();
  }
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (carregando) return <p className="py-10 text-center text-sm text-gray-400">Carregando…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📈 Indicadores de OS</h1>
          <p className="text-sm text-gray-500">Execução, prazo, faturamento e margem · só gerência</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5"><span className="text-xs text-gray-500">De</span>
              <input type="date" className="inp w-40 py-1.5" value={desde} max={ate} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
            <label className="flex items-center gap-1.5"><span className="text-xs text-gray-500">até</span>
              <input type="date" className="inp w-40 py-1.5" value={ate} min={desde} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {([["30", "30 dias"], ["90", "90 dias"], ["mes", "Este mês"], ["mesAnt", "Mês passado"], ["ano", "Este ano"]] as const).map(([k, l]) => (
              <button key={k} className="rounded-full px-2.5 py-1 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => atalho(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi t="Em aberto" v={String(abertas.length)} s={`${atrasadas.length} atrasada(s)`} alerta={atrasadas.length > 0} />
        <Kpi t="Concluídas no período" v={String(concl.length)} s={comPrazo.length ? `${pct(noPrazo.length, comPrazo.length)} no prazo (${noPrazo.length} de ${comPrazo.length})` : "sem prazo definido"} />
        <Kpi t="Tempo médio de execução" v={tempoMedio == null ? "—" : `${tempoMedio.toFixed(1)} dias`}
          s={tempos.length ? `de ${tempos.length} OS · do início da execução à conclusão` : "aparece quando as OS passarem por “Em execução”"} />
        <Kpi t="Margem média" v={margemMedia == null ? "—" : `${margemMedia.toFixed(1)}%`} s={`${comMargem.length} OS com valor de venda`} />
        <Kpi t="A faturar" v={formatCurrency(valorAFaturar)} s={`${aFaturar.length} OS concluída(s) sem faturamento`} alerta={aFaturar.length > 0} />
        <Kpi t="Faturado no período" v={formatCurrency(faturado)} s={`${faturadas.length} OS`} />
        <Kpi t="Pausadas" v={String(pausadas.length)}
          s={MOTIVOS_PAUSA.map((m) => [m.label, pausadas.filter((p) => p.motivo_pausa === m.value).length] as const).filter(([, n]) => n).map(([l, n]) => `${n} ${l.toLowerCase()}`).join(" · ") || "nenhuma"} />
        <Kpi t="Custo acima / prejuízo" v={String(estouradas.length)} alerta={estouradas.length > 0} s="OS com custo > previsto ou margem negativa" />
      </div>

      {aFaturar.length > 0 && (
        <Tabela t={`💵 Concluídas aguardando faturamento (${aFaturar.length})`}>
          <div className="flex flex-wrap items-center gap-3 bg-gray-50 px-4 py-2 text-xs text-gray-600">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sel.size === aFaturar.length} onChange={(e) => setSel(e.target.checked ? new Set(aFaturar.map((o) => o.id)) : new Set())} />
              selecionar todas
            </label>
            <span className="text-gray-400">OS antigas já cobradas fora do sistema? Selecione e marque como faturadas.</span>
            <button className="btn-ghost ml-auto py-1 text-xs ring-1 ring-gray-200" disabled={!sel.size || marcando} onClick={marcarFaturadas}>
              {marcando ? "Marcando…" : `✓ Marcar ${sel.size || ""} como já faturada(s)`}
            </button>
          </div>
          {erro && <p className="px-4 py-2 text-sm text-red-600">{erro}</p>}
          {aFaturar.map((o) => (
            <div key={o.id} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50">
              <input type="checkbox" checked={sel.has(o.id)} onChange={() => alternar(o.id)} aria-label="Selecionar" />
              <Link href={`/os/${o.id}`} className="flex min-w-0 flex-1 items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-gray-400">{rotOS(o)}</span>
              <span className="min-w-0 flex-1 truncate">{o.titulo} <span className="text-xs text-gray-400">· {clientes[o.cliente_id ?? ""] ?? "—"}</span></span>
              <span className="hidden text-xs text-gray-500 sm:inline">{o.data_realizado ? `concluída ${formatDate(o.data_realizado)}` : "sem data de conclusão"}</span>
              <span className="w-28 text-right font-medium tabular-nums">{o.valor_venda != null ? formatCurrency(o.valor_venda) : <span className="text-amber-700">sem valor</span>}</span>
              </Link>
            </div>
          ))}
        </Tabela>
      )}

      {estouradas.length > 0 && (
        <Tabela t="⚠ Custo acima do previsto ou com prejuízo">
          {estouradas.map(({ o, r }) => (
            <Link key={o.id} href={`/os/${o.id}`} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50">
              <span className="w-20 shrink-0 text-xs text-gray-400">{rotOS(o)}</span>
              <span className="min-w-0 flex-1 truncate">{o.titulo}</span>
              <span className="text-xs text-gray-500">custo {formatCurrency(r!.custo_total)}{r!.custo_estimado ? ` / previsto ${formatCurrency(r!.custo_estimado)}` : ""}</span>
              <span className={`w-28 text-right font-medium tabular-nums ${(r!.margem ?? 0) < 0 ? "text-red-600" : "text-amber-700"}`}>
                {r!.margem != null ? formatCurrency(r!.margem) : "sem venda"}
              </span>
            </Link>
          ))}
        </Tabela>
      )}

      <Tabela t={`Por cliente · concluídas de ${formatDate(desde)} a ${formatDate(ate)}`}>
        {porCliente.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">Nenhuma OS concluída no período.</p> : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-4 py-2">Cliente</th><th className="px-4 py-2 text-right">OS</th><th className="px-4 py-2 text-right">Venda</th><th className="px-4 py-2 text-right">Custo</th><th className="px-4 py-2 text-right">Margem</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {porCliente.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2">{clientes[c.id] ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.n}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(c.venda)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{formatCurrency(c.custo)}</td>
                  <td className={`px-4 py-2 text-right font-medium tabular-nums ${c.margem < 0 ? "text-red-600" : "text-green-700"}`}>
                    {formatCurrency(c.margem)}{c.venda ? <span className="ml-1 text-xs text-gray-500">({Math.round((c.margem / c.venda) * 100)}%)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tabela>
    </div>
  );
}

function Kpi({ t, v, s, alerta }: { t: string; v: string; s?: string; alerta?: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-gray-500">{t}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${alerta ? "text-red-600" : "text-gray-900"}`}>{alerta && "⚠ "}{v}</p>
      {s && <p className="mt-0.5 text-[11px] text-gray-400">{s}</p>}
    </div>
  );
}
function Tabela({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{t}</h2>
      <div className="card divide-y divide-gray-100 overflow-x-auto">{children}</div>
    </section>
  );
}
