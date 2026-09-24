"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { normalizar, numeroBR } from "@/lib/planilha";
import { DESTINOS, qtdBR, type DestinoTipo } from "@/lib/almox";

type Produto = { id: string; codigo: string | null; nome: string; unidade: string | null };
type Opcao = { id: string; nome: string };

// Nova requisição com os itens na mesma tela; mostra quanto já existe em estoque
// (o almoxarifado atende pelo estoque e só o que faltar vira compra).
export default function RequisicaoNova() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { userId } = useAcesso();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [saldoTotal, setSaldoTotal] = useState<Record<string, number>>({});
  const [oss, setOss] = useState<Opcao[]>([]);
  const [obras, setObras] = useState<Opcao[]>([]);
  const [setores, setSetores] = useState<Opcao[]>([]);
  const [solicitante, setSolicitante] = useState("");
  const [destTipo, setDestTipo] = useState<DestinoTipo | "">("");
  const [destId, setDestId] = useState("");
  const [obs, setObs] = useState("");
  const [linhas, setLinhas] = useState<{ produto: Produto; qtd: string }[]>([]);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("produtos").select("id, codigo, nome, unidade").eq("ativo", true).order("nome").range(0, 19999),
      supabase.from("saldos_estoque").select("produto_id, quantidade").range(0, 49999),
      supabase.from("ordens_servico").select("id, numero, titulo").in("status", ["a_fazer", "em_andamento"]).order("numero", { ascending: false }).range(0, 999),
      supabase.from("obras_servicos").select("id, local").in("status", ["planejada", "em_execucao"]).order("local").range(0, 999),
      supabase.from("centros_custo").select("id, nome").eq("ativo", true).order("nome"),
      userId ? supabase.from("perfis").select("nome").eq("id", userId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([p, s, o, ob, cc, eu]: any[]) => {
      setProdutos(p.data ?? []);
      const tot: Record<string, number> = {};
      for (const r of s.data ?? []) tot[r.produto_id] = (tot[r.produto_id] ?? 0) + Number(r.quantidade);
      setSaldoTotal(tot);
      setOss((o.data ?? []).map((x: any) => ({ id: x.id, nome: [x.numero, x.titulo].filter(Boolean).join(" · ") })));
      setObras((ob.data ?? []).map((x: any) => ({ id: x.id, nome: x.local || "(obra sem local)" })));
      setSetores(cc.data ?? []);
      if (eu.data?.nome) setSolicitante((s0) => s0 || eu.data.nome);
    });
  }, [supabase, userId]);

  const sugestoes = useMemo(() => {
    const q = normalizar(busca);
    if (q.length < 2) return [];
    const ja = new Set(linhas.map((l) => l.produto.id));
    return produtos.filter((p) => !ja.has(p.id) && (normalizar(p.nome).includes(q) || normalizar(p.codigo).includes(q))).slice(0, 8);
  }, [busca, produtos, linhas]);

  const opcoesDestino = destTipo === "os" ? oss : destTipo === "obra" ? obras : destTipo === "setor" ? setores : [];
  const invalidas = linhas.filter((l) => { const q = numeroBR(l.qtd); return q == null || Number.isNaN(q) || q <= 0; });

  async function salvar() {
    if (!linhas.length || invalidas.length) return;
    setGravando(true); setErro(null);
    const { data: req, error } = await supabase.from("requisicoes_compra").insert({
      solicitante: solicitante.trim() || null, observacao: obs.trim() || null, data: new Date().toISOString().slice(0, 10),
      destino_tipo: destTipo && destId ? destTipo : null,
      os_id: destTipo === "os" ? destId || null : null, obra_id: destTipo === "obra" ? destId || null : null,
      centro_custo_id: destTipo === "setor" ? destId || null : null,
    }).select("id").single();
    if (error) { setGravando(false); setErro(error.message); return; }
    const { error: e2 } = await supabase.from("itens_requisicao_compra").insert(
      linhas.map((l) => ({ requisicao_id: req.id, produto_id: l.produto.id, quantidade: numeroBR(l.qtd) })));
    setGravando(false);
    if (e2) { setErro(e2.message); return; }
    router.push(`/compras/requisicao/${req.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">📝 Nova requisição de material</h1>
        <p className="text-sm text-gray-500">O almoxarifado entrega o que tiver em estoque; só o que faltar vira compra.</p>
      </div>

      <div className="card space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="lbl">Solicitante</span>
            <input className="inp" value={solicitante} onChange={(e) => setSolicitante(e.target.value)} />
          </label>
          <label className="block"><span className="lbl">Observação</span>
            <input className="inp" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="para quê / urgência" />
          </label>
        </div>

        <div>
          <span className="lbl">Para onde vai o material (opcional — agiliza a entrega)</span>
          <div className="grid grid-cols-3 gap-2">
            {DESTINOS.map((d) => (
              <button key={d.key} type="button" onClick={() => { setDestTipo(destTipo === d.key ? "" : d.key); setDestId(""); }}
                className={`rounded-lg border py-2 text-sm ${destTipo === d.key ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-gray-200 text-gray-600"}`}>
                {d.icon} {d.label}
              </button>
            ))}
          </div>
          {destTipo && (
            <select className="inp mt-2" value={destId} onChange={(e) => setDestId(e.target.value)}>
              <option value="">— escolher —</option>
              {opcoesDestino.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          )}
        </div>

        <div>
          <span className="lbl">Itens *</span>
          <div className="relative">
            <input className="inp" placeholder="Buscar produto por nome ou código…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {sugestoes.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
                {sugestoes.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-gray-100"
                      onClick={() => { setLinhas((l) => [...l, { produto: p, qtd: "1" }]); setBusca(""); }}>
                      <span className="flex-1">{p.codigo && <span className="mr-2 text-xs text-gray-400">{p.codigo}</span>}{p.nome}</span>
                      <span className={`text-xs ${(saldoTotal[p.id] ?? 0) > 0 ? "text-green-700" : "text-gray-400"}`}>
                        {(saldoTotal[p.id] ?? 0) > 0 ? `em estoque: ${qtdBR(saldoTotal[p.id])} ${p.unidade ?? ""}` : "sem estoque"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {linhas.length > 0 && (
            <ul className="mt-2 divide-y rounded-lg border">
              {linhas.map((l, i) => {
                const est = saldoTotal[l.produto.id] ?? 0;
                const q = numeroBR(l.qtd) ?? 0;
                return (
                  <li key={l.produto.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{l.produto.nome}</p>
                      <p className={`text-xs ${est >= q && est > 0 ? "text-green-700" : est > 0 ? "text-amber-700" : "text-gray-400"}`}>
                        {est >= q && est > 0 ? `✓ tem em estoque (${qtdBR(est)})` : est > 0 ? `estoque parcial: ${qtdBR(est)} — o resto vira compra` : "sem estoque — vira compra"}
                      </p>
                    </div>
                    <input inputMode="decimal" className="inp w-24 text-right" value={l.qtd}
                      onChange={(e) => setLinhas((x) => x.map((y, k) => (k === i ? { ...y, qtd: e.target.value } : y)))} />
                    <span className="w-8 text-xs text-gray-500">{l.produto.unidade}</span>
                    <button type="button" className="px-1 text-gray-300 hover:text-red-500" onClick={() => setLinhas((x) => x.filter((_, k) => k !== i))} aria-label="Remover">✕</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
        <button className="btn-primary w-full py-3" disabled={gravando || linhas.length === 0 || invalidas.length > 0} onClick={salvar}>
          {gravando ? "Salvando…" : `Enviar requisição${linhas.length ? ` (${linhas.length} ${linhas.length === 1 ? "item" : "itens"})` : ""}`}
        </button>
      </div>
    </div>
  );
}
