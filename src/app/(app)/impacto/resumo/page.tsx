"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const fmtKg = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " kg";
const nf = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export default function ResumoProducaoPage() {
  const supabase = useMemo(() => createClient(), []);
  const [cliente, setCliente] = useState("");
  const [colaborador, setColaborador] = useState("");
  const [ano, setAno] = useState("");
  const [mes, setMes] = useState("");
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [colaboradores, setColaboradores] = useState<{ id: string; nome: string }[]>([]);
  const [servMap, setServMap] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [carregando, setCarregando] = useState(true);

  const colNome = useMemo(() => Object.fromEntries(colaboradores.map((c) => [c.id, c.nome])), [colaboradores]);

  useEffect(() => {
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
    supabase.from("colaboradores").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setColaboradores(data ?? []));
    supabase.from("servicos").select("id, nome").range(0, 4999).then(({ data }) =>
      setServMap(Object.fromEntries((data ?? []).map((s: any) => [s.id, s.nome]))));
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("producao").select("cliente_id, colaborador_id, peca_nome, tipo, servico_id, quantidade, peso_total, valor_total, data");
    if (cliente) q = q.eq("cliente_id", cliente);
    if (colaborador) q = q.eq("colaborador_id", colaborador);
    if (ano) {
      if (mes) {
        const m = parseInt(mes), y = parseInt(ano);
        const prox = m === 12 ? `${y + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, "0")}-01`;
        q = q.gte("data", `${ano}-${mes}-01`).lt("data", prox);
      } else {
        q = q.gte("data", `${ano}-01-01`).lt("data", `${parseInt(ano) + 1}-01-01`);
      }
    }
    const { data } = await q.range(0, 9999);
    setRows(data ?? []);
    setCarregando(false);
  }, [supabase, cliente, colaborador, ano, mes]);

  useEffect(() => { carregar(); }, [carregar]);

  const tot = rows.reduce((a, r) => ({
    q: a.q + Number(r.quantidade || 0), peso: a.peso + Number(r.peso_total || 0), valor: a.valor + Number(r.valor_total || 0),
  }), { q: 0, peso: 0, valor: 0 });

  const porPeca = useMemo(() => agrupar(rows, "peca_nome").slice(0, 15), [rows]);
  const porTipo = useMemo(() => agrupar(rows, "tipo"), [rows]);
  const porServico = useMemo(() => agrupar(rows, "servico_id").map((l) => ({ ...l, nome: servMap[l.nome] ?? "—" })), [rows, servMap]);

  // produtividade por colaborador
  const porColaborador = useMemo(() => {
    const m = new Map<string, { id: string; q: number; peso: number; valor: number; dias: Set<string>; lanc: number }>();
    for (const r of rows) {
      const k = r.colaborador_id || "—";
      const p = m.get(k) ?? { id: k, q: 0, peso: 0, valor: 0, dias: new Set<string>(), lanc: 0 };
      p.q += Number(r.quantidade || 0); p.peso += Number(r.peso_total || 0); p.valor += Number(r.valor_total || 0);
      p.lanc += 1; if (r.data) p.dias.add(String(r.data).slice(0, 10));
      m.set(k, p);
    }
    return Array.from(m.values()).map((p) => ({
      nome: colNome[p.id] ?? "— (sem colaborador)",
      lanc: p.lanc, q: p.q, peso: p.peso, valor: p.valor, dias: p.dias.size,
      pesoDia: p.dias.size ? p.peso / p.dias.size : 0,
      valorDia: p.dias.size ? p.valor / p.dias.size : 0,
    })).sort((a, b) => b.peso - a.peso);
  }, [rows, colNome]);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">🏭 Resumo de produção (Impacto)</h1>
          <p className="text-sm text-gray-500">peso, valor e produtividade por colaborador</p>
        </div>
        <PrintButton />
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <select className="inp !w-auto py-1.5" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={colaborador} onChange={(e) => setColaborador(e.target.value)}>
          <option value="">Todos os colaboradores</option>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={ano} onChange={(e) => { setAno(e.target.value); if (!e.target.value) setMes(""); }}>
          <option value="">Qualquer ano</option><option value="2025">2025</option><option value="2026">2026</option>
        </select>
        <select className="inp !w-auto py-1.5" value={mes} onChange={(e) => setMes(e.target.value)} disabled={!ano}>
          <option value="">Ano todo</option>
          {MESES.map((m, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
        </select>
        {carregando && <span className="text-sm text-gray-400">carregando…</span>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card titulo="Lançamentos" valor={String(rows.length)} />
        <Card titulo="Peças produzidas" valor={nf(tot.q)} />
        <Card titulo="Peso total" valor={fmtKg(tot.peso)} />
        <Card titulo="Valor total" valor={formatCurrency(tot.valor)} cor="text-brand-600" />
      </div>

      {/* Produtividade por colaborador */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Produtividade por colaborador</h2>
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Colaborador</th>
                <th className="px-4 py-2 text-right">Lançam.</th>
                <th className="px-4 py-2 text-right">Peças</th>
                <th className="px-4 py-2 text-right">Peso</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2 text-right">Dias</th>
                <th className="px-4 py-2 text-right">Peso/dia</th>
                <th className="px-4 py-2 text-right">Valor/dia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {porColaborador.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">—</td></tr>
              ) : porColaborador.map((l, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-800">{l.nome}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.lanc}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nf(l.q)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nf(l.peso)} kg</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(l.valor)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.dias}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">{nf(l.pesoDia)} kg</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(l.valorDia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Tabela titulo="Top peças" linhas={porPeca} chave="peça" />
        <Tabela titulo="Por serviço" linhas={porServico} chave="serviço" />
        <Tabela titulo="Por tipo" linhas={porTipo} chave="tipo" />
      </div>
    </div>
  );
}

function agrupar(rows: Row[], campo: string) {
  const m = new Map<string, { nome: string; q: number; peso: number; valor: number }>();
  for (const r of rows) {
    const k = r[campo] || "—";
    const p = m.get(k) ?? { nome: k, q: 0, peso: 0, valor: 0 };
    p.q += Number(r.quantidade || 0); p.peso += Number(r.peso_total || 0); p.valor += Number(r.valor_total || 0);
    m.set(k, p);
  }
  return Array.from(m.values()).sort((a, b) => b.valor - a.valor);
}

function Card({ titulo, valor, cor = "text-gray-900" }: { titulo: string; valor: string; cor?: string }) {
  return <div className="card p-4"><p className="text-xs text-gray-500">{titulo}</p><p className={`mt-1 text-2xl font-semibold ${cor}`}>{valor}</p></div>;
}

function Tabela({ titulo, linhas, chave }: { titulo: string; linhas: any[]; chave: string }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{titulo}</h2>
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-2">{chave}</th><th className="px-4 py-2 text-right">Qtd</th><th className="px-4 py-2 text-right">Peso</th><th className="px-4 py-2 text-right">Valor</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">—</td></tr>
            ) : linhas.map((l, i) => (
              <tr key={i}>
                <td className="px-4 py-2">{l.nome}</td>
                <td className="px-4 py-2 text-right tabular-nums">{nf(l.q)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{nf(l.peso)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(l.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
