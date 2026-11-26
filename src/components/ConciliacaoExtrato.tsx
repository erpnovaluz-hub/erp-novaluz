"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buscarTodos } from "@/lib/supabase/buscarTodos";
import { formatCurrency, formatDate } from "@/lib/format";
import { decodificar, detectarFormato } from "@/lib/financeiro/extrato";

type Row = Record<string, any>;
type Opc = { id: string; nome: string };
type Edicao = { acao: string; descricao: string; categoria_id: string; fornecedor_id: string; cliente_id: string };

const ROTULO: Record<string, string> = {
  vincular: "🔗 Já lançado — só ligar",
  baixar: "✅ Dar baixa no título",
  lancar: "➕ Lançar como pago",
  ignorar: "🚫 Ignorar",
};

// Conciliação de extrato: sobe o OFX/CSV/PDF do banco, o sistema casa cada
// linha com os títulos (regra fixa) e a IA só sugere categoria/fornecedor para
// o que sobrou. Nada mexe no saldo até a pessoa confirmar.
export default function ConciliacaoExtrato({ empresaId }: { empresaId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [contas, setContas] = useState<Row[]>([]);
  const [conta, setConta] = useState("");
  const [aba, setAba] = useState<"pendente" | "conciliado" | "ignorado">("pendente");
  const [linhas, setLinhas] = useState<Row[]>([]);
  const [cats, setCats] = useState<(Opc & { natureza: string })[]>([]);
  const [forns, setForns] = useState<Opc[]>([]);
  const [clis, setClis] = useState<Opc[]>([]);
  const [ultimo, setUltimo] = useState<Row | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Edicao>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, ca, f, cl] = await Promise.all([
        supabase.from("contas_bancarias").select("id,nome,saldo_atual").eq("ativo", true).order("nome"),
        supabase.from("categorias_financeiras").select("id,nome,natureza").eq("ativo", true).order("nome"),
        supabase.from("fornecedores").select("id,nome").eq("ativo", true).order("nome").range(0, 4999),
        supabase.from("clientes").select("id,nome").order("nome").range(0, 4999),
      ]);
      setContas(c.data ?? []); setCats((ca.data as any) ?? []); setForns(f.data ?? []); setClis(cl.data ?? []);
      if (c.data?.length === 1) setConta(c.data[0].id);
    })();
  }, [supabase]);

  const carregar = useCallback(async () => {
    if (!conta) { setLinhas([]); return; }
    const { data } = await buscarTodos<Row>(
      supabase.from("extrato_linhas").select("*").eq("conta_bancaria_id", conta).eq("status", aba).order("data", { ascending: aba === "pendente" }),
      "id",
    );
    setLinhas(data);
    const { data: ex } = await supabase.from("extratos_importados").select("*").eq("conta_bancaria_id", conta)
      .order("criado_em", { ascending: false }).limit(1).maybeSingle();
    setUltimo(ex ?? null);
    // edição inicial = a sugestão; marca o que já está "redondo"
    const e: Record<string, Edicao> = {};
    const m = new Set<string>();
    for (const l of data) {
      const s = l.sugestao ?? {};
      e[l.id] = {
        acao: s.acao ?? "lancar", descricao: s.descricao ?? l.descricao ?? "",
        categoria_id: s.categoria_id ?? "", fornecedor_id: s.fornecedor_id ?? "", cliente_id: s.cliente_id ?? "",
      };
      if (s.acao === "vincular" || s.acao === "baixar" || (s.acao === "lancar" && s.categoria_id)) m.add(l.id);
    }
    setEdits(e); setMarcadas(aba === "pendente" ? m : new Set());
  }, [supabase, conta, aba]);

  useEffect(() => { carregar(); }, [carregar]);

  const contaSel = contas.find((c) => c.id === conta);
  const setEd = (id: string, patch: Partial<Edicao>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const marcar = (id: string) => setMarcadas((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function importar(arq: File) {
    if (!conta) return setErro("Escolha a conta antes de subir o extrato.");
    setErro(null); setAviso(null); setOcupado("Lendo o extrato…");
    try {
      let body: any = { conta_bancaria_id: conta, arquivo_nome: arq.name };
      if (/\.pdf$/i.test(arq.name) || arq.type === "application/pdf") {
        const limpo = arq.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");
        const caminho = `${empresaId}/extratos/${crypto.randomUUID()}-${limpo}`;
        const up = await supabase.storage.from("anexos").upload(caminho, arq, { contentType: "application/pdf" });
        if (up.error) throw new Error(up.error.message);
        body = { ...body, formato: "pdf", caminho };
        setOcupado("Lendo o PDF com a IA (pode levar até 1 minuto)…");
      } else {
        const txt = decodificar(await arq.arrayBuffer());
        body = { ...body, formato: detectarFormato(arq.name, txt), conteudo: txt };
      }
      const r = await fetch("/api/financeiro/extrato/importar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "Falha ao importar.");
      const s = d.sugestoes ?? {};
      setAviso(
        `${d.novas} lançamento(s) novo(s)` + (d.repetidas ? `, ${d.repetidas} já importado(s) antes` : "") +
        `. Sugestões: ${s.vincular ?? 0} já lançados, ${s.baixar ?? 0} para dar baixa, ${s.lancar ?? 0} para lançar.`,
      );
      setAba("pendente");
      await carregar();
    } catch (e: any) {
      setErro(e?.message ?? String(e));
    } finally {
      setOcupado(null);
    }
  }

  async function decidir(ids: string[], forcar?: "ignorar" | "reabrir") {
    if (!ids.length) return;
    const itens = ids.map((id) => {
      const l = linhas.find((x) => x.id === id)!;
      const e = edits[id];
      if (forcar) return { linha_id: id, acao: forcar };
      return {
        linha_id: id, acao: e.acao, titulo_id: l.sugestao?.titulo_id ?? null, descricao: e.descricao,
        categoria_id: e.categoria_id || null, fornecedor_id: e.fornecedor_id || null, cliente_id: e.cliente_id || null,
      };
    });
    const mexeSaldo = itens.filter((i: any) => i.acao === "baixar" || i.acao === "lancar" || i.acao === "reabrir");
    if (mexeSaldo.length) {
      const total = mexeSaldo.reduce((s, i) => s + Math.abs(Number(linhas.find((x) => x.id === i.linha_id)?.valor ?? 0)), 0);
      if (!window.confirm(`${mexeSaldo.length} item(ns) vão mexer no saldo de "${contaSel?.nome}" (total ${formatCurrency(total)}). Confirmar?`)) return;
    }
    setOcupado("Gravando…"); setErro(null);
    try {
      const r = await fetch("/api/financeiro/extrato/decidir", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "Falha ao gravar.");
      const falhas = (d.resultados ?? []).filter((x: any) => !x.ok);
      setAviso(`${itens.length - falhas.length} item(ns) gravado(s).`);
      if (falhas.length) setErro(`${falhas.length} não gravado(s): ` + falhas.slice(0, 3).map((f: any) => f.erro).join(" · "));
      const c = await supabase.from("contas_bancarias").select("id,nome,saldo_atual").eq("ativo", true).order("nome");
      setContas(c.data ?? []);
      await carregar();
    } catch (e: any) {
      setErro(e?.message ?? String(e));
    } finally {
      setOcupado(null);
    }
  }

  async function refazer() {
    setOcupado("Refazendo sugestões…");
    try {
      await fetch("/api/financeiro/extrato/sugerir", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conta_bancaria_id: conta }),
      });
      await carregar();
    } finally { setOcupado(null); }
  }

  const totalMarcado = linhas.filter((l) => marcadas.has(l.id)).reduce((s, l) => s + Number(l.valor), 0);
  const difSaldo = ultimo?.saldo_final != null && contaSel ? Number(contaSel.saldo_atual) - Number(ultimo.saldo_final) : null;

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">🏦 Conciliação de extrato</h1>
        <p className="text-sm text-gray-500">
          Suba o extrato do banco (OFX é o melhor; CSV e PDF também servem). O sistema acha o que já está lançado, o que é baixa de
          título em aberto e o que falta lançar. Nada mexe no saldo antes de você confirmar.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-500">Conta</span>
          <select value={conta} onChange={(e) => setConta(e.target.value)} className="rounded border px-2 py-1.5">
            <option value="">— escolha —</option>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <label className={`cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-white ${conta && !ocupado ? "bg-brand-600" : "pointer-events-none bg-gray-300"}`}>
          📥 Importar extrato
          <input type="file" accept=".ofx,.csv,.txt,.pdf,application/pdf,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importar(f); }} />
        </label>
        {conta && <button onClick={refazer} disabled={!!ocupado} className="text-sm text-gray-600 hover:text-brand-600">↻ Refazer sugestões</button>}
        {contaSel && (
          <div className="ml-auto text-right text-sm">
            <div>Saldo no sistema: <b>{formatCurrency(Number(contaSel.saldo_atual))}</b></div>
            {ultimo?.saldo_final != null && (
              <div className={difSaldo && Math.abs(difSaldo) > 0.005 ? "text-amber-700" : "text-green-700"}>
                Saldo do extrato ({ultimo.periodo_ate ? formatDate(ultimo.periodo_ate) : "último"}): {formatCurrency(Number(ultimo.saldo_final))}
                {difSaldo !== null && Math.abs(difSaldo) > 0.005 ? ` · diferença ${formatCurrency(difSaldo)}` : " · bate ✔"}
              </div>
            )}
          </div>
        )}
      </div>

      {ocupado && <div className="rounded bg-blue-50 p-2 text-sm text-blue-800">{ocupado}</div>}
      {aviso && <div className="rounded bg-green-50 p-2 text-sm text-green-800">{aviso}</div>}
      {erro && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{erro}</div>}

      {conta && (
        <>
          <div className="flex gap-2 text-sm">
            {(["pendente", "conciliado", "ignorado"] as const).map((a) => (
              <button key={a} onClick={() => setAba(a)}
                className={`rounded-full px-3 py-1 ${aba === a ? "bg-brand-600 text-white" : "border bg-white text-gray-600"}`}>
                {a === "pendente" ? "A conciliar" : a === "conciliado" ? "Conciliadas" : "Ignoradas"}
              </button>
            ))}
          </div>

          {aba === "pendente" && linhas.length > 0 && (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-white p-2 text-sm shadow-sm">
              <span>{marcadas.size} marcada(s) · {formatCurrency(totalMarcado)}</span>
              <button onClick={() => decidir([...marcadas])} disabled={!marcadas.size || !!ocupado}
                className="rounded bg-green-600 px-3 py-1 font-medium text-white disabled:opacity-40">Confirmar marcadas</button>
              <button onClick={() => decidir([...marcadas], "ignorar")} disabled={!marcadas.size || !!ocupado}
                className="rounded border px-3 py-1 text-gray-600 disabled:opacity-40">Ignorar marcadas</button>
              <button onClick={() => setMarcadas(marcadas.size ? new Set() : new Set(linhas.map((l) => l.id)))} className="text-gray-500 hover:underline">
                {marcadas.size ? "desmarcar todas" : "marcar todas"}
              </button>
            </div>
          )}

          <div className="space-y-2">
            {linhas.length === 0 && <p className="text-sm text-gray-400">Nada aqui.</p>}
            {linhas.map((l) => {
              const s = l.sugestao ?? {};
              const e = edits[l.id];
              const entrada = Number(l.valor) > 0;
              const opcoesAcao = ["lancar", "ignorar", ...(s.acao === "vincular" ? ["vincular"] : []), ...(s.acao === "baixar" ? ["baixar"] : [])];
              return (
                <div key={l.id} className="rounded-lg border bg-white p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {aba === "pendente" && <input type="checkbox" checked={marcadas.has(l.id)} onChange={() => marcar(l.id)} />}
                    <span className="w-20 text-gray-500">{formatDate(l.data)}</span>
                    <span className="flex-1 truncate" title={l.descricao}>{l.descricao}</span>
                    <span className={`font-semibold ${entrada ? "text-green-700" : "text-red-700"}`}>{formatCurrency(Number(l.valor))}</span>
                    {aba !== "pendente" && (
                      <>
                        <span className="text-xs text-gray-500">{l.efeito === "vinculo" ? "ligado" : l.efeito === "baixa" ? "baixado" : l.efeito === "lancamento" ? "lançado" : ""}</span>
                        <button onClick={() => decidir([l.id], "reabrir")} disabled={!!ocupado} className="text-xs text-gray-500 hover:text-red-600 hover:underline">desfazer</button>
                      </>
                    )}
                  </div>
                  {aba === "pendente" && e && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                      <select value={e.acao} onChange={(ev) => setEd(l.id, { acao: ev.target.value })} className="rounded border px-1.5 py-1 text-xs">
                        {opcoesAcao.map((a) => <option key={a} value={a}>{ROTULO[a]}</option>)}
                      </select>
                      {(e.acao === "vincular" || e.acao === "baixar") && (
                        <span className="text-xs text-gray-600">→ {s.titulo_descricao} <span className="text-gray-400">({s.motivo}{s.alternativas ? `; +${s.alternativas} parecido(s)` : ""})</span></span>
                      )}
                      {e.acao === "lancar" && (
                        <>
                          <input value={e.descricao} onChange={(ev) => setEd(l.id, { descricao: ev.target.value })}
                            className="min-w-[12rem] flex-1 rounded border px-1.5 py-1 text-xs" placeholder="descrição" />
                          <select value={e.categoria_id} onChange={(ev) => setEd(l.id, { categoria_id: ev.target.value })} className="max-w-[12rem] rounded border px-1.5 py-1 text-xs">
                            <option value="">categoria…</option>
                            {cats.filter((c) => c.natureza === (entrada ? "receita" : "despesa")).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                          </select>
                          {entrada ? (
                            <select value={e.cliente_id} onChange={(ev) => setEd(l.id, { cliente_id: ev.target.value })} className="max-w-[12rem] rounded border px-1.5 py-1 text-xs">
                              <option value="">cliente…</option>
                              {clis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                          ) : (
                            <select value={e.fornecedor_id} onChange={(ev) => setEd(l.id, { fornecedor_id: ev.target.value })} className="max-w-[12rem] rounded border px-1.5 py-1 text-xs">
                              <option value="">fornecedor…</option>
                              {forns.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                          )}
                          {s.origem === "regra" && <span className="text-[11px] text-green-700">aprendido</span>}
                          {s.origem === "ia" && <span className="text-[11px] text-purple-700">sugestão IA</span>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
