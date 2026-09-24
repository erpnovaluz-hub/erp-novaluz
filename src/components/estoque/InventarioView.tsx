"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso, usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { normalizar, numeroBR } from "@/lib/planilha";
import ImportarPlanilha, { type ProdutoBase } from "@/components/estoque/ImportarPlanilha";
import { STATUS_INV, TIPO_INV } from "@/components/estoque/InventariosLista";

type Inventario = {
  id: string; numero: string | null; deposito_id: string; tipo: "saldo_inicial" | "contagem"; data: string;
  status: "rascunho" | "confirmado" | "cancelado"; observacao: string | null; confirmado_em: string | null;
};
type Item = {
  id: string; produto_id: string; quantidade_contada: number | null; custo_unitario: number | null;
  quantidade_sistema: number | null; diferenca: number | null;
};
type Produto = ProdutoBase & { custo_medio: number | null; ativo: boolean };
type Filtro = "todos" | "pendentes" | "diferenca";

const SECAO_LABEL: Record<string, string> = {
  epis: "EPIs", eletricos: "Elétricos", metalicos: "Metálicos", ferramentas: "Ferramentas",
  consumiveis: "Consumíveis", hidraulico: "Hidráulico", outros: "Outros",
};
const fmtQtd = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 }));

export default function InventarioView({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { gerencia } = useAcesso();                 // custo só para a gerência
  const podeEditar = usePode("estoque", "editar");
  const [inv, setInv] = useState<Inventario | null>(null);
  const [depNome, setDepNome] = useState("");
  const [itens, setItens] = useState<Item[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [edicao, setEdicao] = useState<Record<string, { qtd?: string; custo?: string }>>({});
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [secao, setSecao] = useState("");
  const [busca, setBusca] = useState("");
  const [addBusca, setAddBusca] = useState("");
  const [importando, setImportando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const { data: i } = await supabase.from("inventarios").select("*").eq("id", id).maybeSingle();
    if (!i) { setInv(null); return; }
    const [d, it, p, s] = await Promise.all([
      supabase.from("depositos").select("nome").eq("id", i.deposito_id).maybeSingle(),
      supabase.from("inventario_itens").select("*").eq("inventario_id", id).range(0, 19999),
      supabase.from("produtos").select("id, codigo, nome, unidade, secao, custo_medio, ativo").order("nome").range(0, 19999),
      supabase.from("saldos_estoque").select("produto_id, quantidade").eq("deposito_id", i.deposito_id).range(0, 19999),
    ]);
    setInv(i as Inventario);
    setDepNome(d.data?.nome ?? "");
    setItens((it.data ?? []) as Item[]);
    setProdutos((p.data ?? []) as Produto[]);
    setSaldos(Object.fromEntries(((s.data ?? []) as any[]).map((r) => [r.produto_id, Number(r.quantidade)])));
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  const prodPorId = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p])) as Record<string, Produto>, [produtos]);
  const rascunho = inv?.status === "rascunho";
  const editavel = rascunho && podeEditar;

  // no rascunho a diferença é contra o saldo de agora; confirmado, fica a gravada
  const sistema = (it: Item) => (rascunho ? saldos[it.produto_id] ?? 0 : Number(it.quantidade_sistema ?? 0));
  const diferenca = (it: Item) => (it.quantidade_contada == null ? null : rascunho ? Number(it.quantidade_contada) - sistema(it) : Number(it.diferenca ?? 0));

  const linhas = useMemo(() => {
    const q = normalizar(busca);
    return itens
      .map((it) => ({ it, p: prodPorId[it.produto_id] }))
      .filter(({ it, p }) => p
        && (!secao || p.secao === secao)
        && (!q || normalizar(p.nome).includes(q) || normalizar(p.codigo).includes(q))
        && (filtro === "todos" || (filtro === "pendentes" ? it.quantidade_contada == null : (diferenca(it) ?? 0) !== 0)))
      .sort((a, b) => (a.p.secao ?? "").localeCompare(b.p.secao ?? "") || a.p.nome.localeCompare(b.p.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, prodPorId, busca, secao, filtro, saldos, rascunho]);

  const resumo = useMemo(() => {
    let contados = 0, sobras = 0, faltas = 0, valor = 0;
    for (const it of itens) {
      const d = diferenca(it);
      if (d == null) continue;
      contados++;
      if (d > 0) sobras++; else if (d < 0) faltas++;
      const custo = Number(it.custo_unitario ?? prodPorId[it.produto_id]?.custo_medio ?? 0);
      valor += d * custo;
    }
    return { total: itens.length, contados, sobras, faltas, valor };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, saldos, prodPorId, rascunho]);

  function aviso(ok: boolean, t: string) { setMsg({ ok, t }); if (ok) setTimeout(() => setMsg(null), 3500); }

  async function salvarItem(it: Item) {
    const e = edicao[it.id];
    if (!e) return;
    const campos: Partial<Item> & { atualizado_em: string } = { atualizado_em: new Date().toISOString() };
    if (e.qtd !== undefined) {
      const v = e.qtd.trim() === "" ? null : numeroBR(e.qtd);
      if (v != null && (Number.isNaN(v) || v < 0)) { aviso(false, "Quantidade inválida."); return; }
      campos.quantidade_contada = v;
    }
    if (e.custo !== undefined && gerencia) {
      const v = e.custo.trim() === "" ? null : numeroBR(e.custo);
      if (v != null && (Number.isNaN(v) || v < 0)) { aviso(false, "Custo inválido."); return; }
      campos.custo_unitario = v;
    }
    setItens((l) => l.map((x) => (x.id === it.id ? { ...x, ...campos } : x)));
    setEdicao((m) => { const n = { ...m }; delete n[it.id]; return n; });
    const { error } = await supabase.from("inventario_itens").update(campos).eq("id", it.id);
    if (error) { aviso(false, error.message); carregar(); }
  }

  async function adicionar(produtoIds: string[]) {
    const ja = new Set(itens.map((i) => i.produto_id));
    const novos = produtoIds.filter((p) => !ja.has(p)).map((produto_id) => ({ inventario_id: id, produto_id }));
    if (novos.length === 0) { aviso(true, "Esses produtos já estão na lista."); return; }
    for (let k = 0; k < novos.length; k += 500) {
      const { error } = await supabase.from("inventario_itens").insert(novos.slice(k, k + 500));
      if (error) { aviso(false, error.message); return; }
    }
    aviso(true, `${novos.length} produto(s) adicionado(s).`);
    carregar();
  }

  async function carregarDoDeposito() {
    const doDep = Object.keys(saldos).filter((pid) => (saldos[pid] ?? 0) !== 0);
    const ativos = produtos.filter((p) => p.ativo && (!secao || p.secao === secao)).map((p) => p.id);
    const escolha = window.confirm(
      `OK = todos os ${ativos.length} produto(s) ativos${secao ? ` da seção ${SECAO_LABEL[secao]}` : ""}\n` +
      `Cancelar = só os ${doDep.length} que têm saldo neste depósito`);
    adicionar(escolha ? ativos : doDep.filter((pid) => !secao || prodPorId[pid]?.secao === secao));
  }

  async function remover(it: Item) {
    const { error } = await supabase.from("inventario_itens").delete().eq("id", it.id);
    if (error) { aviso(false, error.message); return; }
    setItens((l) => l.filter((x) => x.id !== it.id));
  }

  // "contado = sistema" para quem conferiu e está tudo certo
  async function igualarSistema(it: Item) {
    setEdicao((m) => ({ ...m, [it.id]: { ...m[it.id], qtd: String(sistema(it)).replace(".", ",") } }));
    const { error } = await supabase.from("inventario_itens").update({ quantidade_contada: sistema(it), atualizado_em: new Date().toISOString() }).eq("id", it.id);
    if (error) { aviso(false, error.message); return; }
    setItens((l) => l.map((x) => (x.id === it.id ? { ...x, quantidade_contada: sistema(it) } : x)));
    setEdicao((m) => { const n = { ...m }; delete n[it.id]; return n; });
  }

  async function confirmar() {
    const pend = resumo.total - resumo.contados;
    const texto = `Confirmar ${inv?.numero}?\n\n` +
      `• ${resumo.contados} item(ns) contado(s)` + (pend ? ` — ${pend} sem contagem serão ignorados` : "") + `\n` +
      `• ${resumo.sobras} com sobra (entrada) e ${resumo.faltas} com falta (saída)\n\n` +
      `O estoque do depósito ${depNome} será acertado agora. Isso não pode ser desfeito (só com outro inventário).`;
    if (!window.confirm(texto)) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc("confirmar_inventario", { p_inventario: id });
    setOcupado(false);
    if (error) { aviso(false, error.message); return; }
    aviso(true, `Inventário confirmado: ${data ?? 0} movimentação(ões) de acerto lançada(s).`);
    carregar();
  }

  async function cancelar() {
    if (!window.confirm("Cancelar este inventário? Nada é lançado no estoque.")) return;
    const { error } = await supabase.from("inventarios").update({ status: "cancelado" }).eq("id", id);
    if (error) { aviso(false, error.message); return; }
    carregar();
  }

  const sugestoes = useMemo(() => {
    const q = normalizar(addBusca);
    if (q.length < 2) return [];
    const ja = new Set(itens.map((i) => i.produto_id));
    return produtos.filter((p) => !ja.has(p.id) && (normalizar(p.nome).includes(q) || normalizar(p.codigo).includes(q))).slice(0, 8);
  }, [addBusca, produtos, itens]);

  if (!inv) return <div className="p-8 text-center text-sm text-gray-400">Carregando…</div>;

  const corDif = (d: number | null) => (d == null ? "text-gray-300" : d > 0 ? "text-green-700" : d < 0 ? "text-red-600" : "text-gray-400");
  const txtDif = (d: number | null) => (d == null ? "—" : d > 0 ? `+${fmtQtd(d)}` : fmtQtd(d));
  const secoesPresentes = Array.from(new Set(itens.map((i) => prodPorId[i.produto_id]?.secao).filter(Boolean))) as string[];

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center gap-2 text-sm text-gray-400">
        <Link href="/estoque/inventario" className="hover:text-gray-700">Inventários</Link> <span>/</span> <span className="text-gray-600">{inv.numero}</span>
      </div>

      {/* cabeçalho */}
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-gray-900">
            📋 {inv.numero} · {depNome}
            <Badge value={inv.tipo} options={TIPO_INV} /> <Badge value={inv.status} options={STATUS_INV} />
          </h1>
          <p className="text-sm text-gray-500">
            {formatDate(inv.data)}{inv.observacao ? ` · ${inv.observacao}` : ""}
            {inv.confirmado_em && ` · confirmado em ${formatDateTime(inv.confirmado_em)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => window.print()}>
            🖨️ {rascunho ? "Folha de contagem" : "Imprimir resultado"}
          </button>
          {editavel && <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => setImportando(true)}>📥 Colar da planilha</button>}
          {editavel && <button className="btn-ghost text-sm text-gray-500" onClick={cancelar}>Cancelar inventário</button>}
          {editavel && <button className="btn-primary text-sm" disabled={ocupado || resumo.contados === 0} onClick={confirmar}>✓ Confirmar e acertar estoque</button>}
        </div>
      </div>

      {msg && <div className={`no-print rounded-lg p-3 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.t}</div>}

      {/* resumo */}
      <div className="no-print grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi t="Contados" v={`${resumo.contados}/${resumo.total}`} />
        <Kpi t="Com sobra" v={String(resumo.sobras)} cor={resumo.sobras ? "text-green-700" : undefined} />
        <Kpi t="Com falta" v={String(resumo.faltas)} cor={resumo.faltas ? "text-red-600" : undefined} />
        {gerencia ? <Kpi t="Diferença em R$" v={formatCurrency(resumo.valor)} cor={resumo.valor < 0 ? "text-red-600" : resumo.valor > 0 ? "text-green-700" : undefined} />
                  : <Kpi t="Pendentes" v={String(resumo.total - resumo.contados)} />}
      </div>

      {/* adicionar produtos */}
      {editavel && (
        <div className="no-print card flex flex-wrap items-center gap-2 p-2">
          <div className="relative min-w-[220px] flex-1">
            <input className="inp" placeholder="Adicionar produto (nome ou código)…" value={addBusca} onChange={(e) => setAddBusca(e.target.value)} />
            {sugestoes.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
                {sugestoes.map((p) => (
                  <li key={p.id}>
                    <button className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => { adicionar([p.id]); setAddBusca(""); }}>
                      {p.codigo && <span className="mr-2 text-xs text-gray-400">{p.codigo}</span>}{p.nome}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={carregarDoDeposito}>+ Carregar produtos</button>
        </div>
      )}

      {/* filtros */}
      <div className="no-print flex flex-wrap items-center gap-2 text-sm">
        <div className="abas-rolaveis flex gap-1">
          {([["todos", "Todos"], ["pendentes", "Não contados"], ["diferenca", "Com diferença"]] as [Filtro, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`rounded-full px-3 py-1 ${filtro === k ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}>{l}</button>
          ))}
        </div>
        <select className="inp w-40 py-1" value={secao} onChange={(e) => setSecao(e.target.value)}>
          <option value="">Todas as seções</option>
          {secoesPresentes.map((s) => <option key={s} value={s}>{SECAO_LABEL[s] ?? s}</option>)}
        </select>
        <input className="inp w-48 py-1" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {/* celular: cartões com campo grande */}
      <div className="no-print card divide-y divide-gray-100 overflow-hidden sm:hidden">
        {linhas.length === 0 ? <p className="px-4 py-10 text-center text-sm text-gray-400">Nenhum item neste filtro.</p>
          : linhas.map(({ it, p }) => {
            const d = diferenca(it);
            return (
              <div key={it.id} className="px-4 py-3">
                <p className="font-medium text-gray-900">{p.nome}</p>
                <p className="text-xs text-gray-400">{[p.codigo, SECAO_LABEL[p.secao ?? ""], p.unidade].filter(Boolean).join(" · ")}</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="text-xs text-gray-500">Sistema<br /><b className="text-sm text-gray-800">{fmtQtd(sistema(it))}</b></div>
                  {editavel ? (
                    <input inputMode="decimal" className="inp w-28 text-right text-lg font-semibold" placeholder="contado"
                      value={edicao[it.id]?.qtd ?? (it.quantidade_contada == null ? "" : String(it.quantidade_contada).replace(".", ","))}
                      onChange={(e) => setEdicao((m) => ({ ...m, [it.id]: { ...m[it.id], qtd: e.target.value } }))}
                      onBlur={() => salvarItem(it)} />
                  ) : <div className="text-xs text-gray-500">Contado<br /><b className="text-sm text-gray-800">{fmtQtd(it.quantidade_contada)}</b></div>}
                  <div className={`ml-auto text-right text-sm font-semibold ${corDif(d)}`}>{txtDif(d)}</div>
                </div>
                {editavel && it.quantidade_contada == null && (
                  <button className="mt-1 text-xs text-brand-600" onClick={() => igualarSistema(it)}>= igual ao sistema</button>
                )}
              </div>
            );
          })}
      </div>

      {/* computador: tabela (também é a folha impressa) */}
      <div className="card hidden overflow-x-auto sm:block print:block">
        <div className="print-only mb-3">
          <h1 className="text-lg font-bold">{rascunho ? "Folha de contagem" : "Resultado do inventário"} — {inv.numero}</h1>
          <p className="text-sm">Depósito: {depNome} · {TIPO_INV.find((t) => t.value === inv.tipo)?.label} · {formatDate(inv.data)}
            {rascunho && " · Contador: ______________________  Data: ___/___/______"}</p>
        </div>
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Produto</th>
              <th className="px-3 py-2">Un</th>
              {/* contagem cega: a folha impressa não mostra o saldo do sistema */}
              <th className={`px-3 py-2 text-right ${rascunho ? "print:hidden" : ""}`}>Sistema</th>
              <th className="px-3 py-2 text-right">Contado</th>
              <th className="px-3 py-2 text-right print:hidden">Diferença</th>
              {!rascunho && <th className="hidden px-3 py-2 text-right print:table-cell">Diferença</th>}
              {gerencia && <th className="px-3 py-2 text-right print:hidden">Custo un.</th>}
              {editavel && <th className="px-3 py-2 print:hidden"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                {itens.length === 0 ? "Nenhum produto ainda. Use “Colar da planilha” ou “Carregar produtos”." : "Nenhum item neste filtro."}
              </td></tr>
            ) : linhas.map(({ it, p }) => {
              const d = diferenca(it);
              return (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-500">{p.codigo || "—"}</td>
                  <td className="px-3 py-1.5 text-gray-900">{p.nome}<span className="ml-2 text-[10px] text-gray-400 print:hidden">{SECAO_LABEL[p.secao ?? ""]}</span></td>
                  <td className="px-3 py-1.5 text-gray-500">{p.unidade}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums text-gray-600 ${rascunho ? "print:hidden" : ""}`}>{fmtQtd(sistema(it))}</td>
                  <td className="px-3 py-1.5 text-right">
                    {editavel ? (
                      <>
                        <input inputMode="decimal" className="inp w-24 py-1 text-right print:hidden"
                          value={edicao[it.id]?.qtd ?? (it.quantidade_contada == null ? "" : String(it.quantidade_contada).replace(".", ","))}
                          onChange={(e) => setEdicao((m) => ({ ...m, [it.id]: { ...m[it.id], qtd: e.target.value } }))}
                          onBlur={() => salvarItem(it)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                        <span className="print-only">{it.quantidade_contada == null ? "________" : fmtQtd(it.quantidade_contada)}</span>
                      </>
                    ) : <span className="tabular-nums">{fmtQtd(it.quantidade_contada)}</span>}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-medium tabular-nums print:hidden ${corDif(d)}`}>{txtDif(d)}</td>
                  {!rascunho && <td className="hidden px-3 py-1.5 text-right tabular-nums print:table-cell">{txtDif(d)}</td>}
                  {gerencia && (
                    <td className="px-3 py-1.5 text-right print:hidden">
                      {editavel ? (
                        <input inputMode="decimal" className="inp w-24 py-1 text-right" placeholder={p.custo_medio ? String(p.custo_medio).replace(".", ",") : "0,00"}
                          title="Vazio = custo médio atual"
                          value={edicao[it.id]?.custo ?? (it.custo_unitario == null ? "" : String(it.custo_unitario).replace(".", ","))}
                          onChange={(e) => setEdicao((m) => ({ ...m, [it.id]: { ...m[it.id], custo: e.target.value } }))}
                          onBlur={() => salvarItem(it)} />
                      ) : <span className="tabular-nums text-gray-600">{formatCurrency(it.custo_unitario ?? p.custo_medio)}</span>}
                    </td>
                  )}
                  {editavel && (
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs print:hidden">
                      {it.quantidade_contada == null && <button className="mr-3 text-brand-600 hover:underline" onClick={() => igualarSistema(it)} title="Conferido: igual ao sistema">= sistema</button>}
                      <button className="text-gray-400 hover:text-red-500" onClick={() => remover(it)}>remover</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rascunho && <p className="print-only mt-6 text-sm">Assinatura do responsável: ____________________________________</p>}
      </div>

      {editavel && gerencia && inv.tipo === "saldo_inicial" && (
        <p className="no-print text-xs text-gray-500">Custo vazio = usa o custo médio atual do produto (produto novo fica com custo zero até a 1ª compra).</p>
      )}

      {importando && (
        <ImportarPlanilha inventarioId={id} produtos={produtos} verCusto={gerencia}
          onFechar={() => setImportando(false)}
          onImportado={(t) => { setImportando(false); aviso(true, t); carregar(); }} />
      )}
    </div>
  );
}

function Kpi({ t, v, cor }: { t: string; v: string; cor?: string }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-gray-500">{t}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${cor ?? "text-gray-900"}`}>{v}</p>
    </div>
  );
}
