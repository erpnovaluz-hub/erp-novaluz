"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import ProducaoDrawer from "@/components/ProducaoDrawer";

type Row = Record<string, any>;
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const LIMITE = 800;

export default function ProducaoView() {
  const supabase = useMemo(() => createClient(), []);

  const [cliente, setCliente] = useState("");
  const [colaborador, setColaborador] = useState("");
  const [servico, setServico] = useState("");
  const [ano, setAno] = useState("");
  const [mes, setMes] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");

  const [rows, setRows] = useState<Row[]>([]);
  const [pecas, setPecas] = useState<any[]>([]);
  const [servicos, setServicos] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [colaboradores, setColaboradores] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<Row | null>(null);

  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);
  const servNome = useMemo(() => Object.fromEntries(servicos.map((s) => [s.id, s.nome])), [servicos]);

  const carregarRefs = useCallback(async () => {
    const [p, s, c, col] = await Promise.all([
      supabase.from("pecas").select("id, nome, peso, tipo").order("nome").range(0, 4999),
      supabase.from("servicos").select("id, nome, valor, unidade").order("nome").range(0, 4999),
      supabase.from("clientes").select("id, nome").order("nome").range(0, 4999),
      supabase.from("colaboradores").select("id, nome").order("nome").range(0, 4999),
    ]);
    setPecas(p.data ?? []); setServicos(s.data ?? []); setClientes(c.data ?? []); setColaboradores(col.data ?? []);
  }, [supabase]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("producao").select("*");
    if (cliente) q = q.eq("cliente_id", cliente);
    if (colaborador) q = q.eq("colaborador_id", colaborador);
    if (servico) q = q.eq("servico_id", servico);
    if (buscaAtiva.trim()) q = q.ilike("peca_nome", `%${buscaAtiva.trim()}%`);
    if (ano) {
      if (mes) {
        const m = parseInt(mes), y = parseInt(ano);
        const prox = m === 12 ? `${y + 1}-01-01` : `${ano}-${String(m + 1).padStart(2, "0")}-01`;
        q = q.gte("data", `${ano}-${mes}-01`).lt("data", prox);
      } else {
        q = q.gte("data", `${ano}-01-01`).lt("data", `${parseInt(ano) + 1}-01-01`);
      }
    }
    const { data } = await q.order("data", { ascending: false }).range(0, 4999);
    setRows(data ?? []); setCarregando(false);
  }, [supabase, cliente, colaborador, servico, buscaAtiva, ano, mes]);

  useEffect(() => { carregarRefs(); }, [carregarRefs]);
  useEffect(() => { carregar(); }, [carregar]);

  const tot = rows.reduce((a, r) => ({
    peso: a.peso + Number(r.peso_total || 0), valor: a.valor + Number(r.valor_total || 0),
  }), { peso: 0, valor: 0 });

  const visiveis = rows.slice(0, LIMITE);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">⚙️ Lançamentos de produção</h1>
        <button className="btn-primary" onClick={() => setEditando({})}>+ Novo</button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="inp !w-auto py-1.5" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={colaborador} onChange={(e) => setColaborador(e.target.value)}>
          <option value="">Todo colaborador</option>
          {colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={servico} onChange={(e) => setServico(e.target.value)}>
          <option value="">Todo serviço</option>
          {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={ano} onChange={(e) => { setAno(e.target.value); if (!e.target.value) setMes(""); }}>
          <option value="">Qualquer ano</option><option value="2025">2025</option><option value="2026">2026</option>
        </select>
        <select className="inp !w-auto py-1.5" value={mes} onChange={(e) => setMes(e.target.value)} disabled={!ano}>
          <option value="">Ano todo</option>
          {MESES.map((m, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setBuscaAtiva(busca); }}>
          <input className="inp !w-44 py-1.5" placeholder="Buscar peça…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </form>
      </div>

      <div className="mb-4 flex flex-wrap gap-6 text-sm">
        <span className="text-gray-500">{rows.length} lançamento(s)</span>
        <span className="text-gray-500">Peso: <b className="text-gray-900">{tot.peso.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg</b></span>
        <span className="text-gray-500">Valor: <b className="text-brand-600">{formatCurrency(tot.valor)}</b></span>
      </div>

      <div className="card overflow-hidden">
        {carregando ? (
          <div className="px-4 py-12 text-center text-gray-400">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">Nenhum lançamento neste filtro.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visiveis.map((r) => (
              <li key={r.id}>
                <button onClick={() => setEditando(r)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-50">
                  <div className="w-20 shrink-0 text-xs text-gray-400">{formatDate(r.data)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{r.peca_nome || "—"} <span className="text-xs font-normal text-gray-400">× {Number(r.quantidade)}</span></p>
                    <p className="truncate text-xs text-gray-400">{servNome[r.servico_id] ?? "sem serviço"} · {cliNome[r.cliente_id] ?? "—"}</p>
                  </div>
                  <div className="w-28 shrink-0 text-right text-sm text-gray-500 tabular-nums">{Number(r.peso_total || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg</div>
                  <div className="w-28 shrink-0 text-right font-medium tabular-nums text-gray-900">{formatCurrency(r.valor_total)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows.length > LIMITE && (
          <div className="border-t px-4 py-2 text-center text-xs text-gray-400">
            Mostrando {LIMITE} de {rows.length} — use os filtros para refinar.
          </div>
        )}
      </div>

      {editando !== null && (
        <ProducaoDrawer
          registro={editando}
          pecas={pecas}
          servicos={servicos}
          clientes={clientes}
          colaboradores={colaboradores}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}
