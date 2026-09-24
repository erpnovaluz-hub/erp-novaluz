"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import PrintButton from "@/components/PrintButton";
import { formatCurrency, formatDate } from "@/lib/format";
import { normalizar } from "@/lib/planilha";
import { TIPO_VALE_OPTS, qtdBR } from "@/lib/almox";

type Linha = {
  item_id: string; vale_id: string; numero: string; tipo: "saida" | "devolucao" | "entrada"; status: string;
  data: string; dia: string; deposito_nome: string | null; colaborador_id: string | null; colaborador_nome: string | null;
  destino_tipo: string | null; destino_nome: string | null; fornecedor_nome: string | null; nota_fiscal: string | null;
  produto_id: string; produto_codigo: string | null; produto_nome: string; unidade: string | null;
  quantidade: number; valor: number | null;
};
type Agrupar = "dia" | "colaborador" | "destino" | "produto";

const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const DEST_ICON: Record<string, string> = { os: "🧷", obra: "🏗️", setor: "🏷️" };

// Diário do almoxarifado: tudo que entrou e saiu, por dia/colaborador/destino/produto.
export default function DiarioAlmox() {
  const supabase = useMemo(() => createClient(), []);
  const { gerencia } = useAcesso();
  const [de, setDe] = useState(hojeISO());
  const [ate, setAte] = useState(hojeISO());
  const [tipo, setTipo] = useState("");
  const [colab, setColab] = useState("");
  const [busca, setBusca] = useState("");
  const [agrupar, setAgrupar] = useState<Agrupar>("dia");
  const [comCancelados, setComCancelados] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("vw_diario_almox").select("*").gte("dia", de).lte("dia", ate).order("data", { ascending: false }).range(0, 9999);
    if (!comCancelados) q = q.eq("status", "ativo");
    const { data, error } = await q;
    if (error) setErro(error.message);
    setLinhas((data ?? []) as Linha[]);
    setCarregando(false);
  }, [supabase, de, ate, comCancelados]);

  useEffect(() => { carregar(); }, [carregar]);

  const colaboradores = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of linhas) if (l.colaborador_id) m.set(l.colaborador_id, l.colaborador_nome ?? "—");
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [linhas]);

  const filtradas = useMemo(() => {
    const q = normalizar(busca);
    return linhas.filter((l) => (!tipo || l.tipo === tipo) && (!colab || l.colaborador_id === colab)
      && (!q || normalizar(l.produto_nome).includes(q) || normalizar(l.produto_codigo).includes(q)
          || normalizar(l.destino_nome).includes(q) || normalizar(l.numero).includes(q)));
  }, [linhas, tipo, colab, busca]);

  const grupos = useMemo(() => {
    const chave = (l: Linha) =>
      agrupar === "dia" ? l.dia
      : agrupar === "colaborador" ? (l.colaborador_nome ?? (l.tipo === "entrada" ? "Entradas avulsas" : "—"))
      : agrupar === "destino" ? (l.destino_nome ? `${DEST_ICON[l.destino_tipo ?? ""] ?? ""} ${l.destino_nome}` : "Entradas avulsas")
      : `${l.produto_nome}${l.unidade ? ` (${l.unidade})` : ""}`;
    const m = new Map<string, Linha[]>();
    for (const l of filtradas) { const k = chave(l); m.set(k, [...(m.get(k) ?? []), l]); }
    const arr = Array.from(m.entries()).map(([k, itens]) => ({ k, itens }));
    return agrupar === "dia" ? arr.sort((a, b) => b.k.localeCompare(a.k)) : arr.sort((a, b) => a.k.localeCompare(b.k));
  }, [filtradas, agrupar]);

  const soma = (ls: Linha[], t: string) => ls.filter((l) => l.tipo === t);
  const vales = (ls: Linha[]) => new Set(ls.map((l) => l.vale_id)).size;
  // consumo líquido: saída soma, devolução desconta, entrada avulsa não é consumo
  const SINAL: Record<Linha["tipo"], number> = { saida: 1, devolucao: -1, entrada: 0 };
  const valor = (ls: Linha[]) => ls.reduce((s, l) => s + SINAL[l.tipo] * Number(l.valor ?? 0), 0);
  const saidas = soma(filtradas, "saida"), devol = soma(filtradas, "devolucao"), entradas = soma(filtradas, "entrada");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📒 Diário do almoxarifado</h1>
          <p className="text-sm text-gray-500">
            {de === ate ? formatDate(de) : `${formatDate(de)} a ${formatDate(ate)}`} · fonte: vales do balcão
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Link href="/estoque/balcao" className="btn-ghost text-sm ring-1 ring-gray-200">🏪 Balcão</Link>
          <PrintButton />
        </div>
      </div>

      {/* filtros */}
      <div className="no-print card flex flex-wrap items-end gap-3 p-3 text-sm">
        <label className="block"><span className="lbl">De</span><input type="date" className="inp py-1.5" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="block"><span className="lbl">Até</span><input type="date" className="inp py-1.5" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <label className="block"><span className="lbl">Tipo</span>
          <select className="inp py-1.5" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {TIPO_VALE_OPTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="block"><span className="lbl">Colaborador</span>
          <select className="inp py-1.5" value={colab} onChange={(e) => setColab(e.target.value)}>
            <option value="">Todos</option>
            {colaboradores.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
        <label className="block min-w-[160px] flex-1"><span className="lbl">Buscar</span>
          <input className="inp py-1.5" placeholder="produto, OS, obra, nº do vale…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <label className="block"><span className="lbl">Agrupar por</span>
          <select className="inp py-1.5" value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
            <option value="dia">Dia</option>
            <option value="colaborador">Colaborador</option>
            <option value="destino">Destino (OS/obra/setor)</option>
            <option value="produto">Produto</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-gray-600">
          <input type="checkbox" checked={comCancelados} onChange={(e) => setComCancelados(e.target.checked)} /> incluir cancelados
        </label>
      </div>

      {/* resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi t="Saídas" v={`${vales(saidas)} vale(s) · ${saidas.length} item(ns)`} />
        <Kpi t="Devoluções" v={`${vales(devol)} vale(s) · ${devol.length} item(ns)`} />
        <Kpi t="Entradas avulsas" v={`${vales(entradas)} vale(s) · ${entradas.length} item(ns)`} />
        {gerencia && <Kpi t="Consumo líquido (custo)" v={formatCurrency(valor(filtradas))} />}
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {carregando ? <p className="py-10 text-center text-sm text-gray-400">Carregando…</p>
        : grupos.length === 0 ? <div className="card p-10 text-center text-sm text-gray-400">Nenhum movimento no período.</div>
        : grupos.map((g) => {
          const qtdTotal = agrupar === "produto"
            ? g.itens.reduce((s, l) => s + (l.tipo === "devolucao" ? -1 : l.tipo === "entrada" ? 0 : 1) * Number(l.quantidade), 0) : null;
          return (
            <section key={g.k} className="break-inside-avoid">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-3 text-sm">
                <h2 className="font-semibold text-gray-800">{agrupar === "dia" ? formatDate(g.k) : g.k}</h2>
                <span className="text-xs text-gray-400">{g.itens.length} item(ns)</span>
                {qtdTotal != null && <span className="text-xs text-gray-500">saída líquida: {qtdBR(qtdTotal)}</span>}
                {gerencia && <span className="ml-auto text-xs text-gray-500">{formatCurrency(valor(g.itens))}</span>}
              </div>
              <div className="card overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">{agrupar === "dia" ? "Hora" : "Data"}</th>
                      <th className="px-3 py-2">Vale</th>
                      <th className="px-3 py-2">Material</th>
                      <th className="px-3 py-2 text-right">Qtd</th>
                      {agrupar !== "colaborador" && <th className="px-3 py-2">Colaborador</th>}
                      {agrupar !== "destino" && <th className="px-3 py-2">Destino / origem</th>}
                      {gerencia && <th className="px-3 py-2 text-right">Custo</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {g.itens.map((l) => (
                      <tr key={l.item_id} className={l.status === "cancelado" ? "text-gray-400 line-through" : ""}>
                        <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">
                          {agrupar === "dia" ? new Date(l.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : formatDate(l.dia)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <Link href={`/estoque/vale/${l.vale_id}`} className="text-brand-700 hover:underline">{l.numero}</Link>
                          <span className="ml-1.5 print:hidden"><Badge value={l.tipo} options={TIPO_VALE_OPTS} /></span>
                        </td>
                        <td className="px-3 py-1.5">{l.produto_codigo && <span className="mr-1.5 text-xs text-gray-400">{l.produto_codigo}</span>}{l.produto_nome}</td>
                        <td className={`whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums ${l.tipo === "saida" ? "text-red-700" : "text-green-700"}`}>
                          {l.tipo === "saida" ? "−" : "+"}{qtdBR(l.quantidade)} <span className="text-xs font-normal text-gray-400">{l.unidade}</span>
                        </td>
                        {agrupar !== "colaborador" && <td className="px-3 py-1.5 text-gray-600">{l.colaborador_nome ?? "—"}</td>}
                        {agrupar !== "destino" && (
                          <td className="px-3 py-1.5 text-gray-600">
                            {l.destino_nome ? `${DEST_ICON[l.destino_tipo ?? ""] ?? ""} ${l.destino_nome}`
                              : [l.fornecedor_nome, l.nota_fiscal && `NF ${l.nota_fiscal}`].filter(Boolean).join(" · ") || "—"}
                          </td>
                        )}
                        {gerencia && <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-600">{formatCurrency(l.valor)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
    </div>
  );
}

function Kpi({ t, v }: { t: string; v: string }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-gray-500">{t}</p>
      <p className="mt-0.5 text-sm font-semibold text-gray-900">{v}</p>
    </div>
  );
}
