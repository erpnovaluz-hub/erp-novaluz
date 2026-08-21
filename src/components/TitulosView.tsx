"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import Badge from "@/components/Badge";
import TituloDrawer from "@/components/TituloDrawer";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;
type Tipo = "pagar" | "receber";

const STATUS = [
  { value: "aberto", label: "Aberto", color: "blue" },
  { value: "pago", label: "Pago", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const CHIPS = [
  { key: "todos", label: "Todos" },
  { key: "aberto", label: "Em aberto" },
  { key: "vencidos", label: "Vencidos" },
  { key: "pago", label: "Pagos" },
];

export default function TitulosView({ tipo }: { tipo: Tipo }) {
  const supabase = useMemo(() => createClient(), []);
  const hoje = new Date().toISOString().slice(0, 10);
  const anoAtual = new Date().getFullYear();

  const [chip, setChip] = useState("todos");
  const [baseData, setBaseData] = useState<"competencia" | "vencimento">("competencia");
  const [ano, setAno] = useState("");
  const [mes, setMes] = useState("");
  const [categoria, setCategoria] = useState("");
  const [subcategoria, setSubcategoria] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<{ id: string; nome: string }[]>([]);
  const [subs, setSubs] = useState<{ id: string; nome: string; categoria_id: string }[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string }[]>([]);
  const [contas, setContas] = useState<{ id: string; nome: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Row | null>(null);

  const catNome = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.nome])), [cats]);
  const subNome = useMemo(() => Object.fromEntries(subs.map((s) => [s.id, s.nome])), [subs]);
  const subsDaCategoria = useMemo(() => subs.filter((s) => s.categoria_id === categoria), [subs, categoria]);

  const carregarRefs = useCallback(async () => {
    const [c, sc, cli, forn, conta] = await Promise.all([
      supabase.from("categorias_financeiras").select("id, nome").order("ordem"),
      supabase.from("subcategorias_financeiras").select("id, nome, categoria_id").order("nome").range(0, 4999),
      supabase.from("clientes").select("id, nome").order("nome").range(0, 4999),
      supabase.from("fornecedores").select("id, nome").order("nome").range(0, 4999),
      supabase.from("contas_bancarias").select("id, nome").eq("ativo", true).order("nome"),
    ]);
    setCats(c.data ?? []); setSubs(sc.data ?? []); setClientes(cli.data ?? []);
    setFornecedores(forn.data ?? []); setContas(conta.data ?? []);
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    let q = supabase.from("titulos_financeiros").select("*").eq("tipo", tipo);
    if (chip === "aberto") q = q.eq("status", "aberto");
    else if (chip === "pago") q = q.eq("status", "pago");
    else if (chip === "vencidos") q = q.eq("status", "aberto").lt("vencimento", hoje);
    if (categoria) q = q.eq("categoria_id", categoria);
    if (subcategoria) q = q.eq("subcategoria_id", subcategoria);
    if (buscaAtiva.trim()) q = q.ilike("descricao", `%${buscaAtiva.trim()}%`);
    if (ano) {
      if (mes) {
        const m = parseInt(mes), y = parseInt(ano);
        const prox = m === 12 ? `${y + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, "0")}-01`;
        q = q.gte(baseData, `${ano}-${mes}-01`).lt(baseData, prox);
      } else {
        q = q.gte(baseData, `${ano}-01-01`).lt(baseData, `${parseInt(ano) + 1}-01-01`);
      }
    }
    const { data, error } = await q.order(baseData, { ascending: false }).range(0, 4999);
    if (error) setErro(error.message);
    setRows(data ?? []); setCarregando(false);
  }, [supabase, tipo, chip, categoria, subcategoria, buscaAtiva, ano, mes, hoje, baseData]);

  useEffect(() => { carregarRefs(); }, [carregarRefs]);
  useEffect(() => { carregar(); }, [carregar]);

  const total = rows.reduce((s, r) => s + Number(r.valor || 0), 0);
  const aberto = rows.filter((r) => r.status === "aberto").reduce((s, r) => s + Number(r.valor || 0), 0);

  const cor = tipo === "pagar" ? "text-red-600" : "text-green-600";
  const titulo = tipo === "pagar" ? "Contas a Pagar" : "Contas a Receber";
  const icon = tipo === "pagar" ? "🔴" : "🟢";
  const anos = ["", "2025", "2026", String(anoAtual)].filter((v, i, a) => a.indexOf(v) === i);
  const filtrando = chip !== "todos" || !!ano || !!categoria || !!subcategoria || !!buscaAtiva;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">{icon} {titulo}</h1>
        <div className="flex items-center gap-2">
          <PrintButton />
          <button className="no-print btn-primary" onClick={() => setEditando({ tipo })}>+ Novo</button>
        </div>
      </div>

      {/* atalhos rápidos */}
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(c.key)}
            className={`rounded-full px-3 py-1 text-sm transition ${chip === c.key ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"}`}
          >
            {c.label}
          </button>
        ))}
        <div className="mx-1 h-5 w-px bg-gray-200" />
        {/* base do período */}
        <button
          type="button"
          onClick={() => setBaseData(baseData === "competencia" ? "vencimento" : "competencia")}
          className="rounded-lg px-2 py-1.5 text-xs text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50"
          title="Alternar a base do filtro de período"
        >
          por {baseData === "competencia" ? "competência" : "vencimento"} ⇄
        </button>
        {/* período */}
        <select className="inp !w-auto py-1.5" value={ano} onChange={(e) => { setAno(e.target.value); if (!e.target.value) setMes(""); }}>
          {anos.map((a) => <option key={a} value={a}>{a === "" ? "Qualquer ano" : a}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={mes} onChange={(e) => setMes(e.target.value)} disabled={!ano}>
          <option value="">Ano todo</option>
          {MESES.map((m, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
        </select>
        {/* categoria */}
        <select className="inp !w-auto py-1.5" value={categoria} onChange={(e) => { setCategoria(e.target.value); setSubcategoria(""); }}>
          <option value="">Toda categoria</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {categoria && (
          <select className="inp !w-auto py-1.5" value={subcategoria} onChange={(e) => setSubcategoria(e.target.value)}>
            <option value="">Toda subcategoria</option>
            {subsDaCategoria.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        )}
        {/* busca */}
        <form onSubmit={(e) => { e.preventDefault(); setBuscaAtiva(busca); }} className="flex items-center gap-1">
          <input className="inp !w-44 py-1.5" placeholder="Buscar descrição…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </form>
        {filtrando && (
          <button className="text-sm text-gray-400 hover:text-gray-700" onClick={() => { setChip("todos"); setAno(""); setMes(""); setCategoria(""); setSubcategoria(""); setBusca(""); setBuscaAtiva(""); }}>
            limpar filtros
          </button>
        )}
      </div>

      {/* resumo */}
      <div className="mb-4 flex flex-wrap gap-6 text-sm">
        <span className="text-gray-500">{rows.length} lançamento(s)</span>
        <span className="text-gray-500">Total: <b className="text-gray-900">{formatCurrency(total)}</b></span>
        <span className="text-gray-500">Em aberto: <b className={cor}>{formatCurrency(aberto)}</b></span>
      </div>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {/* lista (linha clicável) */}
      <div className="card overflow-hidden">
        {carregando ? (
          <div className="px-4 py-12 text-center text-gray-400">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">Nenhum lançamento neste filtro.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const vencido = r.status === "aberto" && r.vencimento && r.vencimento < hoje;
              return (
                <li key={r.id}>
                  <button onClick={() => setEditando(r)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-900">{r.descricao}</p>
                      <p className="truncate text-xs text-gray-400">
                        {catNome[r.categoria_id] ?? "sem categoria"}
                        {r.subcategoria_id && subNome[r.subcategoria_id] ? ` › ${subNome[r.subcategoria_id]}` : ""}
                      </p>
                    </div>
                    <div className="w-28 shrink-0 text-right font-medium tabular-nums text-gray-900">{formatCurrency(r.valor)}</div>
                    <div className={`w-24 shrink-0 text-right text-sm ${vencido ? "font-medium text-red-600" : "text-gray-500"}`}>
                      {formatDate(r.vencimento)}
                    </div>
                    <div className="w-24 shrink-0 text-right"><Badge value={r.status} options={STATUS} /></div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editando !== null && (
        <TituloDrawer
          registro={editando}
          tipo={tipo}
          categorias={cats}
          subcategorias={subs}
          clientes={clientes}
          fornecedores={fornecedores}
          contas={contas}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}
