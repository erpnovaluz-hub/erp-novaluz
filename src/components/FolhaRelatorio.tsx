"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Tipo = { id: string; nome: string };
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const pct = (v: number, t: number) => (t > 0 ? (v / t) * 100 : 0);

export default function FolhaRelatorio() {
  const supabase = useMemo(() => createClient(), []);
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(String(anoAtual));
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [lancs, setLancs] = useState<any[]>([]);
  const [bens, setBens] = useState<any[]>([]);
  const [colabNome, setColabNome] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);

  const anos = useMemo(() => Array.from({ length: 6 }, (_, i) => String(anoAtual - 3 + i)), [anoAtual]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const ini = `${ano}-01-01`, fim = `${+ano + 1}-01-01`;
    const [tpRes, colRes, lRes] = await Promise.all([
      supabase.from("folha_tipos_beneficio").select("id, nome").order("ordem").range(0, 999),
      supabase.from("colaboradores").select("id, nome").range(0, 4999),
      supabase.from("vw_folha_lancamento").select("*").gte("competencia", ini).lt("competencia", fim).range(0, 9999),
    ]);
    setTipos(tpRes.data ?? []);
    setColabNome(Object.fromEntries((colRes.data ?? []).map((c: any) => [c.id, c.nome])));
    const rows = lRes.data ?? [];
    setLancs(rows);
    const ids = rows.map((r: any) => r.id);
    if (ids.length) {
      const { data } = await supabase.from("folha_lancamento_beneficios").select("lancamento_id, tipo_beneficio_id, valor").in("lancamento_id", ids);
      setBens(data ?? []);
    } else setBens([]);
    setCarregando(false);
  }, [supabase, ano]);

  useEffect(() => { carregar(); }, [carregar]);

  const mesDe = (comp: string) => new Date(comp + "T00:00:00").getMonth(); // 0..11
  const lancMes = useMemo(() => Object.fromEntries(lancs.map((l) => [l.id, mesDe(l.competencia)])), [lancs]);

  // por mês
  const porMes = useMemo(() => {
    const base = MESES.map(() => ({ salarios: 0, beneficios: 0, extras: 0, descontos: 0, custo: 0, colabs: 0 }));
    for (const l of lancs) {
      const m = mesDe(l.competencia);
      base[m].salarios += num(l.salario_liquido);
      base[m].beneficios += num(l.total_beneficios);
      base[m].extras += num(l.horas_extras);
      base[m].descontos += num(l.descontos);
      base[m].custo += num(l.custo_total);
      base[m].colabs += 1;
    }
    return base;
  }, [lancs]);

  const totAno = useMemo(() => porMes.reduce((a, m) => ({
    salarios: a.salarios + m.salarios, beneficios: a.beneficios + m.beneficios,
    extras: a.extras + m.extras, descontos: a.descontos + m.descontos, custo: a.custo + m.custo,
  }), { salarios: 0, beneficios: 0, extras: 0, descontos: 0, custo: 0 }), [porMes]);

  const mesesComDados = porMes.filter((m) => m.colabs > 0).length;
  const maxCusto = Math.max(1, ...porMes.map((m) => m.custo));

  // por colaborador (ano)
  const porColab = useMemo(() => {
    const map: Record<string, { custo: number; meses: number }> = {};
    for (const l of lancs) {
      const k = l.colaborador_id;
      (map[k] ??= { custo: 0, meses: 0 });
      map[k].custo += num(l.custo_total); map[k].meses += 1;
    }
    return Object.entries(map)
      .map(([id, v]) => ({ id, nome: colabNome[id] ?? "—", ...v }))
      .sort((a, b) => b.custo - a.custo);
  }, [lancs, colabNome]);

  // por tipo de benefício (ano)
  const porBeneficio = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of bens) map[b.tipo_beneficio_id] = (map[b.tipo_beneficio_id] ?? 0) + num(b.valor);
    return tipos.map((t) => ({ nome: t.nome, valor: map[t.id] ?? 0 })).filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
  }, [bens, tipos]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📊 Relatório da folha</h1>
        <div className="no-print flex items-center gap-2">
          <select className="inp !w-auto py-1.5" value={ano} onChange={(e) => setAno(e.target.value)}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <PrintButton />
        </div>
      </div>

      {carregando ? (
        <div className="card px-4 py-16 text-center text-gray-400">Carregando…</div>
      ) : lancs.length === 0 ? (
        <div className="card px-4 py-16 text-center text-gray-400">Sem lançamentos de folha em {ano}.</div>
      ) : (
        <>
          {/* KPIs do ano */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi titulo="Custo total do ano" valor={formatCurrency(totAno.custo)} destaque />
            <Kpi titulo="Salários líquidos" valor={formatCurrency(totAno.salarios)} />
            <Kpi titulo="Benefícios" valor={formatCurrency(totAno.beneficios)} />
            <Kpi titulo="Horas extras" valor={formatCurrency(totAno.extras)} />
            <Kpi titulo="Média mensal" valor={formatCurrency(mesesComDados ? totAno.custo / mesesComDados : 0)} />
          </div>

          {/* evolução mensal */}
          <div className="card mb-5 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Evolução mensal — custo da folha ({ano})</h2>
            <div className="space-y-1.5">
              {porMes.map((m, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-8 shrink-0 text-xs text-gray-400">{MESES[i]}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                    <div className="flex h-full">
                      <Seg w={pct(m.salarios, maxCusto)} cor="#2563eb" />
                      <Seg w={pct(m.beneficios, maxCusto)} cor="#16a34a" />
                      <Seg w={pct(m.extras, maxCusto)} cor="#f59e0b" />
                    </div>
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs tabular-nums text-gray-700">{m.custo ? formatCurrency(m.custo) : "—"}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
              <Legenda cor="#2563eb" texto="Salários líquidos" />
              <Legenda cor="#16a34a" texto="Benefícios" />
              <Legenda cor="#f59e0b" texto="Horas extras" />
              <span className="text-gray-400">(descontos abatidos no total)</span>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* por colaborador */}
            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Custo por colaborador ({ano})</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
                    <th className="py-2">Colaborador</th>
                    <th className="py-2 text-right">Meses</th>
                    <th className="py-2 text-right">Média/mês</th>
                    <th className="py-2 text-right">Total ano</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {porColab.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 font-medium text-gray-900">{c.nome}</td>
                      <td className="py-2 text-right tabular-nums text-gray-500">{c.meses}</td>
                      <td className="py-2 text-right tabular-nums text-gray-500">{formatCurrency(c.meses ? c.custo / c.meses : 0)}</td>
                      <td className="py-2 text-right font-medium tabular-nums text-gray-900">{formatCurrency(c.custo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* por benefício */}
            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Benefícios por tipo ({ano})</h2>
              {porBeneficio.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">Nenhum benefício lançado.</p>
              ) : (
                <div className="space-y-2">
                  {porBeneficio.map((b) => (
                    <div key={b.nome}>
                      <div className="mb-0.5 flex justify-between text-xs">
                        <span className="text-gray-700">{b.nome}</span>
                        <span className="tabular-nums text-gray-500">{formatCurrency(b.valor)} · {pct(b.valor, totAno.beneficios).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-gray-100">
                        <div className="h-full rounded bg-green-500" style={{ width: `${pct(b.valor, totAno.beneficios)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* tabela mensal detalhada */}
          <div className="card mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
                  <th className="px-3 py-2">Mês</th>
                  <th className="px-3 py-2 text-right">Colab.</th>
                  <th className="px-3 py-2 text-right">Salários</th>
                  <th className="px-3 py-2 text-right">Benefícios</th>
                  <th className="px-3 py-2 text-right">Horas extras</th>
                  <th className="px-3 py-2 text-right">Descontos</th>
                  <th className="px-3 py-2 text-right">Custo total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {porMes.map((m, i) => (
                  <tr key={i} className={m.colabs ? "" : "text-gray-300"}>
                    <td className="px-3 py-2 font-medium">{MESES[i]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.colabs || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.salarios ? formatCurrency(m.salarios) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.beneficios ? formatCurrency(m.beneficios) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.extras ? formatCurrency(m.extras) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.descontos ? formatCurrency(m.descontos) : "—"}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900">{m.custo ? formatCurrency(m.custo) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="px-3 py-2">Total {ano}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totAno.salarios)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totAno.beneficios)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totAno.extras)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totAno.descontos)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-brand-700">{formatCurrency(totAno.custo)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Seg({ w, cor }: { w: number; cor: string }) {
  if (w <= 0) return null;
  return <div style={{ width: `${w}%`, backgroundColor: cor }} className="h-full" />;
}
function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cor }} /> {texto}</span>;
}
function Kpi({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${destaque ? "bg-brand-600 text-white" : "bg-white ring-1 ring-gray-100"}`}>
      <p className={`text-xs ${destaque ? "text-white/80" : "text-gray-400"}`}>{titulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
