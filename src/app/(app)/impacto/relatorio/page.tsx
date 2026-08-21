"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;
const LIMITE = 3000;
const nf = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

type Col = "data" | "peca" | "servico" | "quantidade" | "peso_total" | "colaborador" | "valor_unit" | "valor_total";

export default function RelatorioProducaoPage() {
  const supabase = useMemo(() => createClient(), []);

  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [cliente, setCliente] = useState("");
  const [colaborador, setColaborador] = useState("");
  const [servico, setServico] = useState("");
  const [peca, setPeca] = useState("");
  const [pecaAtiva, setPecaAtiva] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [colaboradores, setColaboradores] = useState<any[]>([]);
  const [servicos, setServicos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sortCol, setSortCol] = useState<Col>("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const colNome = useMemo(() => Object.fromEntries(colaboradores.map((c) => [c.id, c.nome])), [colaboradores]);
  const servNome = useMemo(() => Object.fromEntries(servicos.map((s) => [s.id, s.nome])), [servicos]);

  useEffect(() => {
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
    supabase.from("colaboradores").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setColaboradores(data ?? []));
    supabase.from("servicos").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setServicos(data ?? []));
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("producao").select("data, peca_nome, servico_id, quantidade, peso_total, colaborador_id, valor_unit, valor_total, cliente_id");
    if (dataDe) q = q.gte("data", dataDe);
    if (dataAte) q = q.lte("data", dataAte);
    if (cliente) q = q.eq("cliente_id", cliente);
    if (colaborador) q = q.eq("colaborador_id", colaborador);
    if (servico) q = q.eq("servico_id", servico);
    if (pecaAtiva.trim()) q = q.ilike("peca_nome", `%${pecaAtiva.trim()}%`);
    const { data } = await q.order("data", { ascending: false }).range(0, 9999);
    setRows(data ?? []);
    setCarregando(false);
  }, [supabase, dataDe, dataAte, cliente, colaborador, servico, pecaAtiva]);

  useEffect(() => { carregar(); }, [carregar]);

  const valor = (r: Row, c: Col): any => {
    if (c === "peca") return r.peca_nome ?? "";
    if (c === "servico") return servNome[r.servico_id] ?? "";
    if (c === "colaborador") return colNome[r.colaborador_id] ?? "";
    return r[c];
  };

  const ordenadas = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = valor(a, sortCol), vb = valor(b, sortCol);
      const na = typeof va === "number", nb = typeof vb === "number";
      let cmp = na && nb ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortCol, sortDir, servNome, colNome]);

  function orderBy(c: Col) {
    if (sortCol === c) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(c); setSortDir("asc"); }
  }

  const tot = rows.reduce((a, r) => ({
    q: a.q + Number(r.quantidade || 0), peso: a.peso + Number(r.peso_total || 0), valor: a.valor + Number(r.valor_total || 0),
  }), { q: 0, peso: 0, valor: 0 });

  const visiveis = ordenadas.slice(0, LIMITE);

  const COLS: { key: Col; label: string; num?: boolean }[] = [
    { key: "data", label: "Data" },
    { key: "peca", label: "Peça" },
    { key: "servico", label: "Serviço" },
    { key: "quantidade", label: "Qtd", num: true },
    { key: "peso_total", label: "Peso", num: true },
    { key: "colaborador", label: "Funcionário" },
    { key: "valor_unit", label: "V. unit serviço", num: true },
    { key: "valor_total", label: "Valor total", num: true },
  ];

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📄 Relatório de produção</h1>
          <p className="text-sm text-gray-500">Detalhado · clique no cabeçalho para ordenar por qualquer coluna</p>
        </div>
        <PrintButton />
      </div>

      <div className="no-print mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase text-gray-400">Data de</label>
          <input className="inp !w-auto py-1.5" type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase text-gray-400">Data até</label>
          <input className="inp !w-auto py-1.5" type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
        </div>
        <select className="inp !w-auto py-1.5" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={colaborador} onChange={(e) => setColaborador(e.target.value)}>
          <option value="">Todo funcionário</option>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={servico} onChange={(e) => setServico(e.target.value)}>
          <option value="">Todo serviço</option>
          {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setPecaAtiva(peca); }}>
          <input className="inp !w-40 py-1.5" placeholder="Peça…" value={peca} onChange={(e) => setPeca(e.target.value)} />
        </form>
        <button className="text-sm text-gray-400 hover:text-gray-700" onClick={() => { setDataDe(""); setDataAte(""); setCliente(""); setColaborador(""); setServico(""); setPeca(""); setPecaAtiva(""); }}>limpar</button>
      </div>

      <div className="mb-3 flex flex-wrap gap-6 text-sm text-gray-500">
        <span>{rows.length} lançamento(s)</span>
        <span>Peça (qtd): <b className="text-gray-900">{nf(tot.q)}</b></span>
        <span>Peso: <b className="text-gray-900">{nf(tot.peso)} kg</b></span>
        <span>Valor: <b className="text-brand-600">{formatCurrency(tot.valor)}</b></span>
      </div>

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={`cursor-pointer select-none px-3 py-2 hover:bg-gray-100 ${c.num ? "text-right" : ""}`} onClick={() => orderBy(c.key)}>
                  {c.label}{sortCol === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {carregando ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Carregando…</td></tr>
            ) : visiveis.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Nenhum lançamento neste filtro.</td></tr>
            ) : visiveis.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatDate(r.data)}</td>
                <td className="px-3 py-2">{r.peca_nome ?? "—"}</td>
                <td className="px-3 py-2 text-gray-600">{servNome[r.servico_id] ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(Number(r.quantidade || 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(Number(r.peso_total || 0))}</td>
                <td className="px-3 py-2 text-gray-600">{colNome[r.colaborador_id] ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.valor_unit)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(r.valor_total)}</td>
              </tr>
            ))}
          </tbody>
          {visiveis.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>Totais</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(tot.q)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{nf(tot.peso)}</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right tabular-nums text-brand-600">{formatCurrency(tot.valor)}</td>
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length > LIMITE && (
          <div className="border-t px-4 py-2 text-center text-xs text-gray-400">Mostrando {LIMITE} de {rows.length} — refine o intervalo de datas.</div>
        )}
      </div>
    </div>
  );
}
