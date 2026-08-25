"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;
const CAP = 200;
const PALETTE = ["#2563eb","#16a34a","#f59e0b","#ef4444","#8b5cf6","#0ea5e9","#ec4899","#14b8a6","#f97316","#64748b"];
const pct = (v: number, t: number) => (t > 0 ? (v / t) * 100 : 0);

export default function RelatorioFinanceiro() {
  const supabase = useMemo(() => createClient(), []);
  const hoje = new Date().toISOString().slice(0, 10);
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);

  const catNome = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c.nome])), [categorias]);
  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);

  useEffect(() => {
    supabase.from("categorias_financeiras").select("id, nome").order("ordem").range(0, 4999).then(({ data }) => setCategorias(data ?? []));
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("titulos_financeiros").select("tipo, status, valor, vencimento, competencia, categoria_id, cliente_id, descricao");
    if (dataDe) q = q.gte("vencimento", dataDe);
    if (dataAte) q = q.lte("vencimento", dataAte);
    const { data } = await q.range(0, 9999);
    setRows(data ?? []);
    setCarregando(false);
  }, [supabase, dataDe, dataAte]);

  useEffect(() => { carregar(); }, [carregar]);

  // filtros dinâmicos (cliente / categoria / status) aplicados no cliente
  const filtradas = useMemo(() => rows.filter((r) =>
    (!fCliente || r.cliente_id === fCliente) &&
    (!fCategoria || r.categoria_id === fCategoria) &&
    (!fStatus || r.status === fStatus)
  ), [rows, fCliente, fCategoria, fStatus]);

  const R = useMemo(() => {
    const desp = filtradas.filter((r) => r.tipo === "pagar");
    const rec = filtradas.filter((r) => r.tipo === "receber");
    const soma = (arr: Row[]) => arr.reduce((s, r) => s + Number(r.valor || 0), 0);
    const despPagas = soma(desp.filter((r) => r.status === "pago"));
    const despAberto = soma(desp.filter((r) => r.status === "aberto"));
    const despVenc = soma(desp.filter((r) => r.status === "aberto" && r.vencimento && r.vencimento < hoje));
    const recReceb = soma(rec.filter((r) => r.status === "pago"));
    const recAberto = soma(rec.filter((r) => r.status === "aberto"));
    const agrupa = (arr: Row[], nomeDe: (r: Row) => string) => {
      const m = new Map<string, number>();
      for (const r of arr) { const k = nomeDe(r); m.set(k, (m.get(k) || 0) + Number(r.valor || 0)); }
      return Array.from(m.entries()).map(([nome, v]) => ({ nome, v })).sort((a, b) => b.v - a.v);
    };
    const porCat = agrupa(desp, (r) => catNome[r.categoria_id] || "Sem categoria");
    const porCli = agrupa(rec, (r) => cliNome[r.cliente_id] || "Sem cliente");
    return { desp, rec, despPagas, despAberto, despVenc, recReceb, recAberto, porCat, porCli,
             despTotal: despPagas + despAberto, recTotal: recReceb + recAberto };
  }, [filtradas, catNome, cliNome, hoje]);

  const despDetalhe = useMemo(() => [...R.desp].sort((a, b) => Number(b.valor) - Number(a.valor)), [R.desp]);
  const recDetalhe = useMemo(() => [...R.rec].sort((a, b) => Number(b.valor) - Number(a.valor)), [R.rec]);
  const filtrando = fCliente || fCategoria || fStatus || dataDe || dataAte;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📊 Relatório do setor financeiro</h1>
          <p className="text-sm text-gray-500">Despesas e receitas · pago × em aberto · por categoria e cliente</p>
        </div>
        <PrintButton />
      </div>

      {/* filtros dinâmicos */}
      <div className="no-print flex flex-wrap items-end gap-2">
        <div><label className="mb-1 block text-[11px] uppercase text-gray-400">Vencimento de</label><input className="inp !w-auto py-1.5" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} /></div>
        <div><label className="mb-1 block text-[11px] uppercase text-gray-400">até</label><input className="inp !w-auto py-1.5" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} /></div>
        <select className="inp !w-auto py-1.5" value={fCliente} onChange={(e) => setFCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={fCategoria} onChange={(e) => setFCategoria(e.target.value)}>
          <option value="">Toda categoria</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Todo status</option>
          <option value="pago">Pago</option>
          <option value="aberto">Em aberto</option>
          <option value="cancelado">Cancelado</option>
        </select>
        {filtrando && <button className="text-sm text-gray-400 hover:text-gray-700" onClick={() => { setDataDe(""); setDataAte(""); setFCliente(""); setFCategoria(""); setFStatus(""); }}>limpar</button>}
        {carregando && <span className="text-sm text-gray-400">carregando…</span>}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi t="Despesas pagas" v={formatCurrency(R.despPagas)} cor="text-red-600" />
        <Kpi t="Receitas recebidas" v={formatCurrency(R.recReceb)} cor="text-green-600" />
        <Kpi t="Despesas em aberto" v={formatCurrency(R.despAberto)} cor="text-amber-600" />
        <Kpi t="Receitas em aberto" v={formatCurrency(R.recAberto)} cor="text-blue-600" />
        <Kpi t="Despesas vencidas" v={formatCurrency(R.despVenc)} cor="text-red-700" />
      </div>

      {/* Gráficos donut */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Donut titulo="Despesas por categoria" dados={R.porCat} total={R.despTotal} />
        <Donut titulo="Receitas por cliente" dados={R.porCli} total={R.recTotal} />
      </div>

      {/* Distribuição pago x aberto */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Barra titulo="Despesas — situação" partes={[{ rot: "Pago", v: R.despPagas, cor: "#16a34a" }, { rot: "Em aberto", v: R.despAberto, cor: "#f59e0b" }]} total={R.despTotal} />
        <Barra titulo="Receitas — situação" partes={[{ rot: "Recebido", v: R.recReceb, cor: "#16a34a" }, { rot: "Em aberto", v: R.recAberto, cor: "#3b82f6" }]} total={R.recTotal} />
      </div>

      <Detalhe titulo="Detalhamento das despesas" linhas={despDetalhe} total={R.despTotal} catNome={catNome} />
      <Detalhe titulo="Detalhamento das receitas" linhas={recDetalhe} total={R.recTotal} catNome={catNome} cli={cliNome} />
    </div>
  );
}

function Kpi({ t, v, cor = "text-gray-900" }: { t: string; v: string; cor?: string }) {
  return <div className="card p-4"><p className="text-xs text-gray-500">{t}</p><p className={`mt-1 text-lg font-semibold ${cor}`}>{v}</p></div>;
}

function Donut({ titulo, dados, total }: { titulo: string; dados: { nome: string; v: number }[]; total: number }) {
  const top = dados.slice(0, 8);
  const outros = dados.slice(8).reduce((s, d) => s + d.v, 0);
  const segs = outros > 0 ? [...top, { nome: "Outros", v: outros }] : top;
  const tot = total || segs.reduce((s, d) => s + d.v, 0) || 1;
  const R = 54, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{titulo}</h2>
      {segs.length === 0 ? <p className="py-8 text-center text-sm text-gray-400">Sem dados.</p> : (
        <div className="flex flex-wrap items-center gap-4">
          <svg width="140" height="140" viewBox="0 0 140 140" className="shrink-0">
            <g transform="rotate(-90 70 70)">
              <circle cx="70" cy="70" r={R} fill="none" stroke="#f1f5f9" strokeWidth="18" />
              {segs.map((s, i) => {
                const len = (s.v / tot) * C;
                const el = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />;
                off += len; return el;
              })}
            </g>
          </svg>
          <ul className="flex-1 space-y-1 text-xs">
            {segs.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate"><span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate">{s.nome}</span></span>
                <span className="shrink-0 tabular-nums text-gray-500">{pct(s.v, tot).toFixed(1)}% · {formatCurrency(s.v)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Barra({ titulo, partes, total }: { titulo: string; partes: { rot: string; v: number; cor: string }[]; total: number }) {
  return (
    <div className="card p-4">
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-100">
        {partes.map((p, i) => <div key={i} style={{ width: `${pct(p.v, total)}%`, background: p.cor }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        {partes.map((p, i) => (
          <span key={i} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-3 rounded" style={{ background: p.cor }} />{p.rot}: <b>{formatCurrency(p.v)}</b> <span className="text-gray-400">({pct(p.v, total).toFixed(1)}%)</span></span>
        ))}
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
            <tr><th className="px-4 py-2">Descrição</th><th className="px-4 py-2">{cli ? "Cliente" : "Categoria"}</th><th className="px-4 py-2">Vencimento</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Valor</th></tr>
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
