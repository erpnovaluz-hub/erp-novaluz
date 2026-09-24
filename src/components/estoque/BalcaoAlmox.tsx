"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso, usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { formatDateTime } from "@/lib/format";
import { normalizar, numeroBR } from "@/lib/planilha";
import { DESTINOS, TIPOS_VALE, TIPO_VALE_OPTS, qtdBR, type DestinoTipo, type TipoVale } from "@/lib/almox";

type Produto = { id: string; codigo: string | null; nome: string; unidade: string | null; custo_medio: number | null };
type Linha = { produto: Produto; qtd: string; custo: string };
type Opcao = { id: string; nome: string };

const CHAVE_DEP = "almox.deposito";

// Balcão do almoxarifado: saída (com quem retirou e destino), devolução e entrada avulsa.
// Tudo vira um vale numerado, gravado de uma vez pela rpc registrar_vale.
export default function BalcaoAlmox() {
  const supabase = useMemo(() => createClient(), []);
  const { gerencia } = useAcesso();
  const podeEditar = usePode("estoque", "editar");
  const [tipo, setTipo] = useState<TipoVale>("saida");
  const [depositos, setDepositos] = useState<Opcao[]>([]);
  const [deposito, setDeposito] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [equipe, setEquipe] = useState<Opcao[]>([]);
  const [oss, setOss] = useState<Opcao[]>([]);
  const [obras, setObras] = useState<Opcao[]>([]);
  const [setores, setSetores] = useState<Opcao[]>([]);
  const [fornecedores, setFornecedores] = useState<Opcao[]>([]);
  const [recentes, setRecentes] = useState<any[]>([]);

  const [colaborador, setColaborador] = useState("");
  const [destTipo, setDestTipo] = useState<DestinoTipo | "">("");
  const [destId, setDestId] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [nf, setNf] = useState("");
  const [obs, setObs] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [feito, setFeito] = useState<{ id: string; numero: string } | null>(null);

  // cadastros de apoio
  useEffect(() => {
    Promise.all([
      supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("produtos").select("id, codigo, nome, unidade, custo_medio").eq("ativo", true).order("nome").range(0, 19999),
      supabase.from("vw_equipe").select("id, nome").eq("ativo", true).order("nome").range(0, 4999),
      supabase.from("ordens_servico").select("id, numero, titulo").in("status", ["a_fazer", "em_andamento"]).order("numero", { ascending: false }).range(0, 999),
      supabase.from("obras_servicos").select("id, local").in("status", ["planejada", "em_execucao"]).order("local").range(0, 999),
      supabase.from("centros_custo").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("fornecedores").select("id, nome").order("nome").range(0, 4999),
    ]).then(([d, p, e, o, ob, cc, f]) => {
      setDepositos(d.data ?? []);
      setProdutos((p.data ?? []) as Produto[]);
      setEquipe(e.data ?? []);
      setOss(((o.data ?? []) as any[]).map((x) => ({ id: x.id, nome: [x.numero, x.titulo].filter(Boolean).join(" · ") })));
      setObras(((ob.data ?? []) as any[]).map((x) => ({ id: x.id, nome: x.local || "(obra sem local)" })));
      setSetores(cc.data ?? []);
      setFornecedores(f.data ?? []);
      let salvo = "";
      try { salvo = localStorage.getItem(CHAVE_DEP) ?? ""; } catch {}
      const lista = d.data ?? [];
      setDeposito(lista.some((x) => x.id === salvo) ? salvo : lista[0]?.id ?? "");
    });
  }, [supabase]);

  const carregarSaldos = useCallback(async () => {
    if (!deposito) return;
    const { data } = await supabase.from("saldos_estoque").select("produto_id, quantidade").eq("deposito_id", deposito).range(0, 19999);
    setSaldos(Object.fromEntries(((data ?? []) as any[]).map((r) => [r.produto_id, Number(r.quantidade)])));
  }, [supabase, deposito]);

  const carregarRecentes = useCallback(async () => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const { data } = await supabase.from("vales_almox").select("id, numero, tipo, status, data, colaborador_id")
      .gte("data", hoje.toISOString()).order("data", { ascending: false }).limit(30);
    setRecentes(data ?? []);
  }, [supabase]);

  useEffect(() => { carregarSaldos(); }, [carregarSaldos]);
  useEffect(() => { carregarRecentes(); }, [carregarRecentes]);

  function trocarDeposito(id: string) {
    setDeposito(id);
    try { localStorage.setItem(CHAVE_DEP, id); } catch {}
  }

  const sugestoes = useMemo(() => {
    const q = normalizar(busca);
    if (q.length < 2) return [];
    const ja = new Set(linhas.map((l) => l.produto.id));
    return produtos.filter((p) => !ja.has(p.id) && (normalizar(p.nome).includes(q) || normalizar(p.codigo).includes(q))).slice(0, 8);
  }, [busca, produtos, linhas]);

  function addProduto(p: Produto) {
    setLinhas((l) => [...l, { produto: p, qtd: "1", custo: "" }]);
    setBusca("");
  }
  function mudar(i: number, campo: "qtd" | "custo", v: string) {
    setLinhas((l) => l.map((x, k) => (k === i ? { ...x, [campo]: v } : x)));
  }
  function passo(i: number, delta: number) {
    setLinhas((l) => l.map((x, k) => {
      if (k !== i) return x;
      const atual = numeroBR(x.qtd) ?? 0;
      const novo = Math.max(0, (Number.isNaN(atual) ? 0 : atual) + delta);
      return { ...x, qtd: String(novo).replace(".", ",") };
    }));
  }

  async function novoSetor() {
    const nome = window.prompt("Nome do setor (ex.: Manutenção, Produção, Administrativo):");
    if (!nome?.trim()) return;
    const { data, error } = await supabase.from("centros_custo").insert({ nome: nome.trim() }).select("id, nome").single();
    if (error) { setErro(error.message); return; }
    setSetores((s) => [...s, data].sort((a, b) => a.nome.localeCompare(b.nome)));
    setDestId(data.id);
  }

  function limpar(manterPessoa = false) {
    setLinhas([]); setObs(""); setNf(""); setFornecedor(""); setErro(null);
    if (!manterPessoa) { setColaborador(""); setDestTipo(""); setDestId(""); }
  }

  const problemas: string[] = [];
  if (!deposito) problemas.push("Escolha o depósito");
  if (tipo !== "entrada" && !colaborador) problemas.push(tipo === "saida" ? "Quem retirou?" : "Quem devolveu?");
  if (tipo !== "entrada" && (!destTipo || !destId)) problemas.push("Destino (OS, obra ou setor)");
  if (linhas.length === 0) problemas.push("Inclua pelo menos um item");
  const itensInvalidos = linhas.filter((l) => { const q = numeroBR(l.qtd); return q == null || Number.isNaN(q) || q <= 0; });
  if (itensInvalidos.length) problemas.push("Quantidade inválida em algum item");
  const semSaldo = tipo === "saida" ? linhas.filter((l) => (numeroBR(l.qtd) ?? 0) > (saldos[l.produto.id] ?? 0)) : [];

  async function registrar() {
    if (problemas.length || semSaldo.length) return;
    setGravando(true); setErro(null);
    const p = {
      tipo, deposito_id: deposito, colaborador_id: tipo === "entrada" ? null : colaborador,
      destino_tipo: tipo === "entrada" ? null : destTipo,
      os_id: destTipo === "os" ? destId : null, obra_id: destTipo === "obra" ? destId : null,
      centro_custo_id: destTipo === "setor" ? destId : null,
      fornecedor_id: tipo === "entrada" ? fornecedor || null : null,
      nota_fiscal: tipo === "entrada" ? nf : null, observacao: obs,
      itens: linhas.map((l) => ({
        produto_id: l.produto.id, quantidade: numeroBR(l.qtd),
        custo_unitario: tipo === "entrada" && gerencia && l.custo.trim() ? numeroBR(l.custo) : null,
      })),
    };
    const { data, error } = await supabase.rpc("registrar_vale", { p });
    setGravando(false);
    if (error) { setErro(error.message); return; }
    setFeito(data as any);
    limpar(true);
    carregarSaldos(); carregarRecentes();
  }

  const nomeEquipe = useMemo(() => Object.fromEntries(equipe.map((e) => [e.id, e.nome])), [equipe]);
  const opcoesDestino = destTipo === "os" ? oss : destTipo === "obra" ? obras : destTipo === "setor" ? setores : [];
  const cfg = TIPOS_VALE.find((t) => t.key === tipo)!;

  if (!podeEditar) {
    return <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-gray-500">Seu perfil só consulta o estoque. Veja o <Link className="text-brand-600 hover:underline" href="/estoque/diario">diário do almoxarifado</Link>.</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">🏪 Balcão do almoxarifado</h1>
          <p className="text-sm text-gray-500">Saídas, devoluções e entradas avulsas — cada uma gera um vale numerado.</p>
        </div>
        <Link href="/estoque/diario" className="btn-ghost text-sm ring-1 ring-gray-200">📒 Diário</Link>
      </div>

      {/* tipo */}
      <div className="grid grid-cols-3 gap-2">
        {TIPOS_VALE.map((t) => (
          <button key={t.key} onClick={() => { setTipo(t.key); setFeito(null); setErro(null); }}
            className={`rounded-xl border px-2 py-3 text-sm font-medium transition ${tipo === t.key ? "border-brand-600 bg-brand-600 text-white" : "border-gray-200 bg-white text-gray-700"}`}>
            <span className="block text-lg">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {feito && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <span className="flex-1">✓ <b>{feito.numero}</b> registrado. Estoque atualizado.</span>
          <Link href={`/estoque/vale/${feito.id}`} className="btn-primary px-3 py-1.5">🖨️ Imprimir vale</Link>
          <button className="text-green-700 underline" onClick={() => setFeito(null)}>ok</button>
        </div>
      )}

      <div className="card space-y-4 p-4">
        <label className="block">
          <span className="lbl">Depósito</span>
          <select className="inp" value={deposito} onChange={(e) => trocarDeposito(e.target.value)}>
            {depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        </label>

        {tipo !== "entrada" ? (
          <>
            <label className="block">
              <span className="lbl">{tipo === "saida" ? "Quem retirou" : "Quem devolveu"} *</span>
              <select className="inp" value={colaborador} onChange={(e) => setColaborador(e.target.value)}>
                <option value="">— escolher colaborador —</option>
                {equipe.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </label>
            <div>
              <span className="lbl">{tipo === "saida" ? "Para onde vai" : "De onde volta"} *</span>
              <div className="grid grid-cols-3 gap-2">
                {DESTINOS.map((d) => (
                  <button key={d.key} type="button" onClick={() => { setDestTipo(d.key); setDestId(""); }}
                    className={`rounded-lg border py-2 text-sm ${destTipo === d.key ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-gray-200 text-gray-600"}`}>
                    {d.icon} {d.label}
                  </button>
                ))}
              </div>
              {destTipo && (
                <div className="mt-2 flex gap-2">
                  <select className="inp" value={destId} onChange={(e) => setDestId(e.target.value)}>
                    <option value="">— escolher {DESTINOS.find((d) => d.key === destTipo)?.label} —</option>
                    {opcoesDestino.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                  </select>
                  {destTipo === "setor" && <button type="button" className="btn-ghost shrink-0 text-sm ring-1 ring-gray-200" onClick={novoSetor}>+ setor</button>}
                </div>
              )}
              {destTipo && opcoesDestino.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  {destTipo === "os" ? "Nenhuma OS aberta." : destTipo === "obra" ? "Nenhuma obra planejada ou em execução." : "Nenhum setor cadastrado — use “+ setor”."}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="lbl">Fornecedor (opcional)</span>
              <select className="inp" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}>
                <option value="">—</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="lbl">Nota fiscal (opcional)</span>
              <input className="inp" value={nf} onChange={(e) => setNf(e.target.value)} placeholder="nº da NF" />
            </label>
          </div>
        )}

        {/* itens */}
        <div>
          <span className="lbl">Itens</span>
          <div className="relative">
            <input className="inp" placeholder="Buscar produto por nome ou código…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {sugestoes.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
                {sugestoes.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-100" onClick={() => addProduto(p)}>
                      <span className="flex-1">{p.codigo && <span className="mr-2 text-xs text-gray-400">{p.codigo}</span>}{p.nome}</span>
                      <span className={`text-xs ${(saldos[p.id] ?? 0) > 0 ? "text-gray-500" : "text-red-500"}`}>saldo {qtdBR(saldos[p.id] ?? 0)} {p.unidade}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {linhas.length > 0 && (
            <ul className="mt-2 divide-y rounded-lg border">
              {linhas.map((l, i) => {
                const q = numeroBR(l.qtd) ?? 0;
                const saldo = saldos[l.produto.id] ?? 0;
                const falta = tipo === "saida" && q > saldo;
                return (
                  <li key={l.produto.id} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{l.produto.nome}</p>
                        <p className={`text-xs ${falta ? "font-medium text-red-600" : "text-gray-400"}`}>
                          {l.produto.codigo ? `${l.produto.codigo} · ` : ""}saldo {qtdBR(saldo)} {l.produto.unidade}{falta && " — insuficiente"}
                        </p>
                      </div>
                      <button type="button" className="px-1 text-gray-300 hover:text-red-500" onClick={() => setLinhas((x) => x.filter((_, k) => k !== i))} aria-label="Remover">✕</button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <div className="flex items-center">
                        <button type="button" className="h-10 w-10 rounded-l-lg border text-lg" onClick={() => passo(i, -1)}>−</button>
                        <input inputMode="decimal" className="h-10 w-20 border-y text-center text-base font-semibold outline-none" value={l.qtd} onChange={(e) => mudar(i, "qtd", e.target.value)} />
                        <button type="button" className="h-10 w-10 rounded-r-lg border text-lg" onClick={() => passo(i, 1)}>+</button>
                      </div>
                      <span className="text-sm text-gray-500">{l.produto.unidade}</span>
                      {tipo === "entrada" && gerencia && (
                        <input inputMode="decimal" className="inp ml-auto w-32 py-1.5 text-right" placeholder={`custo (${String(l.produto.custo_medio ?? 0).replace(".", ",")})`}
                          value={l.custo} onChange={(e) => mudar(i, "custo", e.target.value)} title="Vazio = custo médio atual" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <label className="block">
          <span className="lbl">Observação</span>
          <input className="inp" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="opcional" />
        </label>

        {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
        {(problemas.length > 0 || semSaldo.length > 0) && linhas.length > 0 && (
          <p className="text-xs text-amber-700">Falta: {[...problemas, ...(semSaldo.length ? [`saldo insuficiente em ${semSaldo.length} item(ns)`] : [])].join(" · ")}</p>
        )}

        <button className="btn-primary w-full py-3 text-base" disabled={gravando || problemas.length > 0 || semSaldo.length > 0} onClick={registrar}>
          {gravando ? "Registrando…" : `${cfg.icon} Registrar ${cfg.label.toLowerCase()}${linhas.length ? ` (${linhas.length} ${linhas.length === 1 ? "item" : "itens"})` : ""}`}
        </button>
        {linhas.length > 0 && <button className="w-full text-center text-xs text-gray-400" onClick={() => limpar()}>limpar tudo</button>}
      </div>

      {/* vales de hoje */}
      <section>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Hoje</h2>
        <div className="card divide-y divide-gray-100 overflow-hidden">
          {recentes.length === 0 ? <p className="px-4 py-6 text-center text-sm text-gray-400">Nenhum vale registrado hoje.</p>
            : recentes.map((v) => (
              <Link key={v.id} href={`/estoque/vale/${v.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50">
                <span className={`font-medium ${v.status === "cancelado" ? "text-gray-400 line-through" : "text-gray-900"}`}>{v.numero}</span>
                <span className="min-w-0 flex-1 truncate text-gray-500">{v.colaborador_id ? nomeEquipe[v.colaborador_id] ?? "" : ""}</span>
                <span className="text-xs text-gray-400">{formatDateTime(v.data).split(" ")[1]}</span>
                <Badge value={v.tipo} options={TIPO_VALE_OPTS} />
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}
