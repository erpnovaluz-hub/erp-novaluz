"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;
type Regra = { minimo: number; fixo: number; por50: number };
const TIPOS = ["LD", "LP", "LPP"];
const nf = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

function bonusDia(count: number, r?: Regra): number {
  if (!r || count < r.minimo) return 0;
  return r.fixo + Math.floor((count - r.minimo) / 50) * r.por50;
}

export default function BonusPage() {
  const supabase = useMemo(() => createClient(), []);
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [colaborador, setColaborador] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [regras, setRegras] = useState<Record<string, Regra>>({});
  const [colaboradores, setColaboradores] = useState<any[]>([]);
  const [servicosBonus, setServicosBonus] = useState<{ id: string; nome: string }[]>([]);
  const [carregando, setCarregando] = useState(true);

  const colNome = useMemo(() => Object.fromEntries(colaboradores.map((c) => [c.id, c.nome])), [colaboradores]);

  useEffect(() => {
    supabase.from("colaboradores").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setColaboradores(data ?? []));
    supabase.from("bonus_regras").select("tipo, minimo, bonus_fixo, bonus_por_50").eq("ativo", true).then(({ data }) =>
      setRegras(Object.fromEntries((data ?? []).map((r: any) => [String(r.tipo).toUpperCase(), { minimo: Number(r.minimo), fixo: Number(r.bonus_fixo), por50: Number(r.bonus_por_50) }]))));
    supabase.from("servicos").select("id, nome").eq("conta_bonus", true).then(({ data }) => setServicosBonus(data ?? []));
  }, [supabase]);

  const carregar = useCallback(async () => {
    if (servicosBonus.length === 0) { setRows([]); setCarregando(false); return; }
    setCarregando(true);
    let q = supabase.from("producao").select("data, colaborador_id, tipo, quantidade")
      .in("servico_id", servicosBonus.map((s) => s.id));
    if (dataDe) q = q.gte("data", dataDe);
    if (dataAte) q = q.lte("data", dataAte);
    if (colaborador) q = q.eq("colaborador_id", colaborador);
    const { data } = await q.range(0, 9999);
    setRows(data ?? []);
    setCarregando(false);
  }, [supabase, dataDe, dataAte, colaborador, servicosBonus]);

  useEffect(() => { carregar(); }, [carregar]);

  const porFunc = useMemo(() => {
    // 1) soma peças por (dia, funcionário, tipo) — o mínimo é por dia
    const dia = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const tp = String(r.tipo || "").toUpperCase();
      if (!TIPOS.includes(tp)) continue;
      const k = `${String(r.data).slice(0, 10)}|${r.colaborador_id || "—"}`;
      const d = dia.get(k) ?? { LD: 0, LP: 0, LPP: 0 };
      d[tp] += Number(r.quantidade || 0);
      dia.set(k, d);
    }
    // 2) aplica a regra por dia e acumula por funcionário
    const m = new Map<string, any>();
    for (const [k, cont] of dia) {
      const colab = k.split("|")[1];
      const p = m.get(colab) ?? { id: colab, dias: new Set<string>(), pc: { LD: 0, LP: 0, LPP: 0 }, bn: { LD: 0, LP: 0, LPP: 0 } };
      let ganhou = false;
      for (const tp of TIPOS) {
        p.pc[tp] += cont[tp];
        const b = bonusDia(cont[tp], regras[tp]);
        p.bn[tp] += b;
        if (b > 0) ganhou = true;
      }
      if (ganhou) p.dias.add(k.split("|")[0]);
      m.set(colab, p);
    }
    return Array.from(m.values()).map((p) => ({
      nome: colNome[p.id] ?? "— (sem funcionário)",
      dias: p.dias.size, pc: p.pc, bn: p.bn, total: p.bn.LD + p.bn.LP + p.bn.LPP,
    })).sort((a, b) => b.total - a.total);
  }, [rows, regras, colNome]);

  const totalGeral = porFunc.reduce((s, p) => s + p.total, 0);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">💸 Bônus de produção</h1>
          <p className="text-sm text-gray-500">Da produção nos serviços de bônus · fixo + R$/50 acima do mínimo, por dia</p>
        </div>
        <PrintButton />
      </div>

      <div className="no-print mb-2 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase text-gray-400">Data de</label>
          <input className="inp !w-auto py-1.5" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase text-gray-400">Data até</label>
          <input className="inp !w-auto py-1.5" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
        </div>
        <select className="inp !w-auto py-1.5" value={colaborador} onChange={(e) => setColaborador(e.target.value)}>
          <option value="">Todos os funcionários</option>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <Link href="/impacto/producao" className="btn-ghost text-sm ring-1 ring-gray-200">lançar produção</Link>
        {carregando && <span className="text-sm text-gray-400">carregando…</span>}
      </div>

      <p className="no-print mb-4 text-xs text-gray-400">
        Serviços que contam para bônus: {servicosBonus.length ? servicosBonus.map((s) => s.nome).join(" · ") : "nenhum marcado (defina em Cadastros → Serviços)"}
      </p>

      <div className="mb-3 flex flex-wrap gap-6 text-sm text-gray-500">
        <span>{porFunc.length} funcionário(s)</span>
        <span>Período: {dataDe ? formatDate(dataDe) : "início"} → {dataAte ? formatDate(dataAte) : "hoje"}</span>
        <span>Total a pagar: <b className="text-brand-600">{formatCurrency(totalGeral)}</b></span>
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Funcionário</th>
              <th className="px-3 py-2 text-right">Dias</th>
              <th className="px-3 py-2 text-right">LD pç</th>
              <th className="px-3 py-2 text-right">LP pç</th>
              <th className="px-3 py-2 text-right">LPP pç</th>
              <th className="px-3 py-2 text-right">Bônus LD</th>
              <th className="px-3 py-2 text-right">Bônus LP</th>
              <th className="px-3 py-2 text-right">Bônus LPP</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {porFunc.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Nenhuma produção de bônus no período.</td></tr>
            ) : porFunc.map((p, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-800">{p.nome}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.dias}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{nf(p.pc.LD)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{nf(p.pc.LP)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{nf(p.pc.LPP)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(p.bn.LD)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(p.bn.LP)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(p.bn.LPP)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-brand-600">{formatCurrency(p.total)}</td>
              </tr>
            ))}
          </tbody>
          {porFunc.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={8}>Total a pagar no período</td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-600">{formatCurrency(totalGeral)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Conta as peças (LD/LP/LPP) dos lançamentos de produção cujo serviço conta para bônus. Por dia, se as peças do tipo atingem o mínimo, paga o fixo + R$ (por 50) a cada 50 peças acima do mínimo. Regras editáveis em Cadastros → Regras de bônus.
      </p>
    </div>
  );
}
