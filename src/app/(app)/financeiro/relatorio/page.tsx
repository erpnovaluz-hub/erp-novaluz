"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;
const CAP = 200;
const pct = (v: number, t: number) => (t > 0 ? (v / t) * 100 : 0);

export default function RelatorioFinanceiro() {
  const supabase = useMemo(() => createClient(), []);
  const hoje = new Date().toISOString().slice(0, 10);
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [catNome, setCatNome] = useState<Record<string, string>>({});
  const [cliNome, setCliNome] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.from("categorias_financeiras").select("id, nome").range(0, 4999).then(({ data }) =>
      setCatNome(Object.fromEntries((data ?? []).map((c: any) => [c.id, c.nome]))));
    supabase.from("clientes").select("id, nome").range(0, 4999).then(({ data }) =>
      setCliNome(Object.fromEntries((data ?? []).map((c: any) => [c.id, c.nome]))));
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("titulos_financeiros").select("tipo, status, valor, vencimento, competencia, data_pagamento, categoria_id, cliente_id, descricao");
    if (dataDe) q = q.gte("competencia", dataDe);
    if (dataAte) q = q.lte("competencia", dataAte);
    const { data } = await q.range(0, 9999);
    setRows(data ?? []);
    setCarregando(false);
  }, [supabase, dataDe, dataAte]);

  useEffect(() => { carregar(); }, [carregar]);

  const R = useMemo(() => {
    const desp = rows.filter((r) => r.tipo === "pagar");
    const rec = rows.filter((r) => r.tipo === "receber");
    const soma = (arr: Row[]) => arr.reduce((s, r) => s + Number(r.valor || 0), 0);
    const despPagas = soma(desp.filter((r) => r.status === "pago"));
    const despAberto = soma(desp.filter((r) => r.status === "aberto"));
    const despVenc = soma(desp.filter((r) => r.status === "aberto" && r.vencimento && r.vencimento < hoje));
    const recReceb = soma(rec.filter((r) => r.status === "pago"));
    const recAberto = soma(rec.filter((r) => r.status === "aberto"));
    // por categoria (despesas)
    const catMap = new Map<string, number>();
    for (const r of desp) { const k = catNome[r.categoria_id] || "Sem categoria"; catMap.set(k, (catMap.get(k) || 0) + Number(r.valor || 0)); }
    const porCat = Array.from(catMap.entries()).map(([nome, v]) => ({ nome, v })).sort((a, b) => b.v - a.v);
    // por cliente (receitas)
    const cliMap = new Map<string, number>();
    for (const r of rec) { const k = cliNome[r.cliente_id] || "Sem cliente"; cliMap.set(k, (cliMap.get(k) || 0) + Number(r.valor || 0)); }
    const porCli = Array.from(cliMap.entries()).map(([nome, v]) => ({ nome, v })).sort((a, b) => b.v - a.v);
    const despTotal = despPagas + despAberto, recTotal = recReceb + recAberto;
    return { desp, rec, despPagas, despAberto, despVenc, recReceb, recAberto, porCat, porCli, despTotal, recTotal };
  }, [rows, catNome, cliNome, hoje]);

  const despDetalhe = useMemo(() => [...R.desp].sort((a, b) => Number(b.valor) - Number(a.valor)), [R.desp]);
  const recDetalhe = useMemo(() => [...R.rec].sort((a, b) => Number(b.valor) - Number(a.valor)), [R.rec]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📊 Relatório do setor financeiro</h1>
          <p className="text-sm text-gray-500">Despesas e receitas · pago × em aberto · por categoria e cliente</p>
        </div>
        <PrintButton />
      </div>

      <div className="no-print flex flex-wrap items-end gap-2">
        <div><label className="mb-1 block text-[11px] uppercase text-gray-400">Competência de</label><input className="inp !w-auto py-1.5" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} /></div>
        <div><label className="mb-1 block text-[11px] uppercase text-gray-400">até</label><input className="inp !w-auto py-1.5" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} /></div>
        {carregando && <span className="text-sm text-gray-400">carregando…</span>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi t="Despesas pagas" v={formatCurrency(R.despPagas)} cor="text-red-600" />
        <Kpi t="Receitas recebidas" v={formatCurrency(R.recReceb)} cor="text-green-600" />
        <Kpi t="Despesas em aberto" v={formatCurrency(R.despAberto)} cor="text-amber-600" />
        <Kpi t="Receitas em aberto" v={formatCurrency(R.recAberto)} cor="text-blue-600" />
        <Kpi t="Despesas vencidas" v={formatCurrency(R.despVenc)} cor="text-red-700" />
      </div>

      {/* Distribuição */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Barra titulo="Despesas — situação" partes={[
          { rot: "Pago", v: R.despPagas, cor: "bg-green-500" },
          { rot: "Em aberto", v: R.despAberto, cor: "bg-amber-400" },
        ]} total={R.despTotal} />
        <Barra titulo="Receitas — situação" partes={[
          { rot: "Recebido", v: R.recReceb, cor: "bg-green-500" },
          { rot: "Em aberto", v: R.recAberto, cor: "bg-blue-400" },
        ]} total={R.recTotal} />
      </div>

      {/* Breakdowns */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TabelaPct titulo="Despesas por categoria" linhas={R.porCat} total={R.despTotal} />
        <TabelaPct titulo="Receitas por cliente" linhas={R.porCli} total={R.recTotal} />
      </div>

      {/* Detalhamentos */}
      <Detalhe titulo="Detalhamento das despesas" linhas={despDetalhe} total={R.despTotal} catNome={catNome} />
      <Detalhe titulo="Detalhamento das receitas" linhas={recDetalhe} total={R.recTotal} catNome={catNome} cli={cliNome} />
    </div>
  );
}

function Kpi({ t, v, cor = "text-gray-900" }: { t: string; v: string; cor?: string }) {
  return <div className="card p-4"><p className="text-xs text-gray-500">{t}</p><p className={`mt-1 text-lg font-semibold ${cor}`}>{v}</p></div>;
}
function Barra({ titulo, partes, total }: { titulo: string; partes: { rot: string; v: number; cor: string }[]; total: number }) {
  return (
    <div className="card p-4">
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-100">
        {partes.map((p, i) => <div key={i} className={p.cor} style={{ width: `${pct(p.v, total)}%` }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        {partes.map((p, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-3 rounded ${p.cor}`} />
            {p.rot}: <b>{formatCurrency(p.v)}</b> <span className="text-gray-400">({pct(p.v, total).toFixed(1)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
function TabelaPct({ titulo, linhas, total }: { titulo: string; linhas: { nome: string; v: number }[]; total: number }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{titulo}</h2>
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <tbody className="divide-y divide-gray-100">
            {linhas.length === 0 ? <tr><td className="px-4 py-6 text-center text-gray-400">—</td></tr> :
              linhas.map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{l.nome}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCurrency(l.v)}</td>
                  <td className="w-16 px-4 py-2 text-right tabular-nums text-gray-400">{pct(l.v, total).toFixed(1)}%</td>
                </tr>
              ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <tr><td className="px-4 py-2">Total</td><td className="px-4 py-2 text-right tabular-nums">{formatCurrency(total)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
function Detalhe({ titulo, linhas, total, catNome, cli }: { titulo: string; linhas: Row[]; total: number; catNome: Record<string, string>; cli?: Record<string, string> }) {
  const mostra = linhas.slice(0, CAP);
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{titulo} <span className="text-xs font-normal text-gray-400">({linhas.length})</span></h2>
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Descrição</th>
              <th className="px-4 py-2">{cli ? "Cliente" : "Categoria"}</th>
              <th className="px-4 py-2">Vencimento</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {mostra.map((r, i) => (
              <tr key={i}>
                <td className="max-w-md truncate px-4 py-1.5" title={r.descricao}>{r.descricao}</td>
                <td className="px-4 py-1.5 text-gray-500">{cli ? (cli[r.cliente_id] ?? "—") : (catNome[r.categoria_id] ?? "—")}</td>
                <td className="px-4 py-1.5 text-gray-500">{formatDate(r.vencimento)}</td>
                <td className="px-4 py-1.5">{r.status === "pago" ? "Pago" : r.status === "aberto" ? "Em aberto" : r.status}</td>
                <td className="px-4 py-1.5 text-right tabular-nums font-medium">{formatCurrency(r.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <tr><td className="px-4 py-2" colSpan={4}>Total geral{linhas.length > CAP ? ` (mostrando ${CAP} de ${linhas.length})` : ""}</td><td className="px-4 py-2 text-right tabular-nums text-brand-700">{formatCurrency(total)}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
