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
  const [mes, setMes] = useState(""); // "" = ano todo
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
  const escopo = mes ? `${MESES[+mes - 1]}/${ano}` : ano;

  // lançamentos e benefícios dentro do escopo (mês selecionado ou ano todo)
  const lancsF = useMemo(() => (mes ? lancs.filter((l) => mesDe(l.competencia) === +mes - 1) : lancs), [lancs, mes]);
  const idsEscopo = useMemo(() => new Set(lancsF.map((l) => l.id)), [lancsF]);
  const bensF = useMemo(() => bens.filter((b) => idsEscopo.has(b.lancamento_id)), [bens, idsEscopo]);

  // por mês (ano inteiro — gráfico e tabela mensal)
  const porMes = useMemo(() => {
    const base = MESES.map(() => ({ salarios: 0, beneficios: 0, extras: 0, descontos: 0, custo: 0, adiant: 0, fech: 0, colabs: 0 }));
    for (const l of lancs) {
      const m = mesDe(l.competencia);
      base[m].salarios += num(l.salario_liquido);
      base[m].beneficios += num(l.total_beneficios);
      base[m].extras += num(l.horas_extras);
      base[m].descontos += num(l.descontos);
      base[m].custo += num(l.custo_total);
      base[m].adiant += num(l.adiantamento);
      base[m].fech += num(l.fechamento);
      base[m].colabs += 1;
    }
    return base;
  }, [lancs]);

  // totais do escopo (mês selecionado ou ano)
  const tot = useMemo(() => lancsF.reduce((a, l) => ({
    salarios: a.salarios + num(l.salario_liquido), beneficios: a.beneficios + num(l.total_beneficios),
    extras: a.extras + num(l.horas_extras), descontos: a.descontos + num(l.descontos),
    custo: a.custo + num(l.custo_total), adiant: a.adiant + num(l.adiantamento), fech: a.fech + num(l.fechamento),
  }), { salarios: 0, beneficios: 0, extras: 0, descontos: 0, custo: 0, adiant: 0, fech: 0 }), [lancsF]);

  const totAno = useMemo(() => porMes.reduce((a, m) => ({
    salarios: a.salarios + m.salarios, beneficios: a.beneficios + m.beneficios,
    extras: a.extras + m.extras, descontos: a.descontos + m.descontos, custo: a.custo + m.custo,
    adiant: a.adiant + m.adiant, fech: a.fech + m.fech,
  }), { salarios: 0, beneficios: 0, extras: 0, descontos: 0, custo: 0, adiant: 0, fech: 0 }), [porMes]);

  const mesesComDados = porMes.filter((m) => m.colabs > 0).length;
  const maxCusto = Math.max(1, ...porMes.map((m) => m.custo));

  // por colaborador (escopo)
  const porColab = useMemo(() => {
    const map: Record<string, { custo: number; meses: number; faltas: number; adiant: number; fech: number }> = {};
    for (const l of lancsF) {
      const k = l.colaborador_id;
      (map[k] ??= { custo: 0, meses: 0, faltas: 0, adiant: 0, fech: 0 });
      map[k].custo += num(l.custo_total); map[k].meses += 1; map[k].faltas += num(l.faltas);
      map[k].adiant += num(l.adiantamento); map[k].fech += num(l.fechamento);
    }
    return Object.entries(map)
      .map(([id, v]) => ({ id, nome: colabNome[id] ?? "—", ...v }))
      .sort((a, b) => b.custo - a.custo);
  }, [lancsF, colabNome]);

  // por tipo de benefício (escopo)
  const porBeneficio = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of bensF) map[b.tipo_beneficio_id] = (map[b.tipo_beneficio_id] ?? 0) + num(b.valor);
    return tipos.map((t) => ({ nome: t.nome, valor: map[t.id] ?? 0 })).filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
  }, [bensF, tipos]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📊 Relatório da folha</h1>
        <div className="no-print flex items-center gap-2">
          <select className="inp !w-auto py-1.5" value={mes} onChange={(e) => setMes(e.target.value)}>
            <option value="">Ano todo</option>
            {MESES.map((mn, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{mn}</option>)}
          </select>
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
          {/* KPIs do escopo */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Kpi titulo={mes ? `Custo de ${escopo}` : "Custo total do ano"} valor={formatCurrency(tot.custo)} destaque />
            <Kpi titulo="Adiantamento · dia 15" valor={formatCurrency(tot.adiant)} cor="amber" />
            <Kpi titulo="Fechamento · fim do mês" valor={formatCurrency(tot.fech)} cor="blue" />
            <Kpi titulo="Salários líquidos" valor={formatCurrency(tot.salarios)} />
            <Kpi titulo="Benefícios" valor={formatCurrency(tot.beneficios)} />
            <Kpi titulo="Horas extras" valor={formatCurrency(tot.extras)} />
            <Kpi titulo="Descontos" valor={formatCurrency(tot.descontos)} />
            {!mes && <Kpi titulo="Média mensal" valor={formatCurrency(mesesComDados ? totAno.custo / mesesComDados : 0)} />}
          </div>

          {/* evolução mensal */}
          <div className="card mb-5 p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Evolução mensal — custo da folha ({ano})</h2>
            <div className="space-y-1.5">
              {porMes.map((m, i) => (
                <div key={i} className={`flex items-center gap-3 rounded ${mes && +mes - 1 === i ? "bg-brand-50 ring-1 ring-brand-200" : ""}`}>
                  <span className={`w-8 shrink-0 text-xs ${mes && +mes - 1 === i ? "font-semibold text-brand-700" : "text-gray-400"}`}>{MESES[i]}</span>
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
            <div className="card overflow-x-auto p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Custo por colaborador ({escopo})</h2>
              <table className="w-full min-w-[460px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
                    <th className="py-2">Colaborador</th>
                    <th className="py-2 text-right">Faltas</th>
                    <th className="py-2 text-right text-amber-700">Adiant. 40%</th>
                    <th className="py-2 text-right text-blue-700">Fecham. 60%</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {porColab.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 font-medium text-gray-900">{c.nome}</td>
                      <td className={`py-2 text-right tabular-nums ${c.faltas > 0 ? "text-red-600" : "text-gray-400"}`}>{c.faltas || "—"}</td>
                      <td className="py-2 text-right tabular-nums text-amber-700">{formatCurrency(c.adiant)}</td>
                      <td className="py-2 text-right tabular-nums text-blue-700">{formatCurrency(c.fech)}</td>
                      <td className="py-2 text-right font-medium tabular-nums text-gray-900">{formatCurrency(c.custo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 font-semibold">
                    <td className="py-2">Total</td>
                    <td className="py-2" />
                    <td className="py-2 text-right tabular-nums text-amber-700">{formatCurrency(tot.adiant)}</td>
                    <td className="py-2 text-right tabular-nums text-blue-700">{formatCurrency(tot.fech)}</td>
                    <td className="py-2 text-right tabular-nums text-brand-700">{formatCurrency(tot.custo)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* por benefício */}
            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Benefícios por tipo ({escopo})</h2>
              {porBeneficio.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">Nenhum benefício lançado.</p>
              ) : (
                <div className="space-y-2">
                  {porBeneficio.map((b) => (
                    <div key={b.nome}>
                      <div className="mb-0.5 flex justify-between text-xs">
                        <span className="text-gray-700">{b.nome}</span>
                        <span className="tabular-nums text-gray-500">{formatCurrency(b.valor)} · {pct(b.valor, tot.beneficios).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-gray-100">
                        <div className="h-full rounded bg-green-500" style={{ width: `${pct(b.valor, tot.beneficios)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* tabela mensal detalhada */}
          <div className="card mt-5 overflow-x-auto">
            <h2 className="px-3 pt-3 text-sm font-semibold text-gray-700">Detalhamento mensal ({ano})</h2>
            <table className="mt-2 w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
                  <th className="px-3 py-2">Mês</th>
                  <th className="px-3 py-2 text-right">Colab.</th>
                  <th className="px-3 py-2 text-right">Salários</th>
                  <th className="px-3 py-2 text-right">Benefícios</th>
                  <th className="px-3 py-2 text-right">Horas extras</th>
                  <th className="px-3 py-2 text-right">Descontos</th>
                  <th className="px-3 py-2 text-right text-amber-700">Adiant. 40%</th>
                  <th className="px-3 py-2 text-right text-blue-700">Fecham. 60%</th>
                  <th className="px-3 py-2 text-right">Custo total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {porMes.map((m, i) => (
                  <tr key={i} className={`${m.colabs ? "" : "text-gray-300"} ${mes && +mes - 1 === i ? "bg-brand-50" : ""}`}>
                    <td className="px-3 py-2 font-medium">{MESES[i]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.colabs || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.salarios ? formatCurrency(m.salarios) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.beneficios ? formatCurrency(m.beneficios) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.extras ? formatCurrency(m.extras) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.descontos ? formatCurrency(m.descontos) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">{m.adiant ? formatCurrency(m.adiant) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-700">{m.fech ? formatCurrency(m.fech) : "—"}</td>
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
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">{formatCurrency(totAno.adiant)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-700">{formatCurrency(totAno.fech)}</td>
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
function Kpi({ titulo, valor, destaque, cor }: { titulo: string; valor: string; destaque?: boolean; cor?: "amber" | "blue" }) {
  const fundo = destaque ? "bg-brand-600 text-white"
    : cor === "amber" ? "bg-amber-50 ring-1 ring-amber-200"
    : cor === "blue" ? "bg-blue-50 ring-1 ring-blue-200"
    : "bg-white ring-1 ring-gray-100";
  const rotulo = destaque ? "text-white/80" : cor === "amber" ? "text-amber-700" : cor === "blue" ? "text-blue-700" : "text-gray-400";
  return (
    <div className={`rounded-xl p-3 ${fundo}`}>
      <p className={`text-xs ${rotulo}`}>{titulo}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
