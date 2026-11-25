"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { DOSE_MAXIMA, SEGMENTOS, UNIDADES, type Catalogo, type Kpi, type Segmento, type Sentido, type Unidade } from "@/lib/kpis";

// /gestao/indicadores/configurar — gerência: segmento da empresa, escolher
// indicadores do catálogo, criar KPI livre (manual), ativar e ordenar.
export default function IndicadoresConfig() {
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const [segmento, setSegmento] = useState<Segmento | "">("");
  const [catalogo, setCatalogo] = useState<Catalogo[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [todos, setTodos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [livre, setLivre] = useState({ nome: "", descricao: "", unidade: "numero" as Unidade, sentido: "maior" as Sentido });

  const carregar = useCallback(async () => {
    const [e, c, k] = await Promise.all([
      supabase.rpc("empresa_atual"),
      supabase.from("kpi_catalogo").select("*").order("ordem"),
      supabase.from("kpis").select("*").order("ordem").order("criado_em"),
    ]);
    const emp = Array.isArray(e.data) ? e.data[0] : e.data;
    setSegmento((emp?.segmento as Segmento) ?? "");
    setCatalogo((c.data ?? []) as Catalogo[]);
    setKpis((k.data ?? []) as Kpi[]);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  async function rodar(p: PromiseLike<{ error: any }>) {
    setErro(null);
    const { error } = await p;
    if (error) { setErro(error.message); return false; }
    await carregar();
    return true;
  }

  if (!acesso.gerencia) {
    return <p className="mx-auto mt-16 max-w-md text-center text-sm text-gray-500">Só a gerência configura os indicadores.</p>;
  }

  const ativos = kpis.filter((k) => k.ativo);
  const usados = new Set(kpis.map((k) => k.catalogo_chave).filter(Boolean));
  const sugeridos = catalogo.filter((c) => todos || c.segmentos.includes("comum") || (segmento && c.segmentos.includes(segmento)));
  const proxOrdem = () => (kpis.reduce((m, k) => Math.max(m, k.ordem), 0) || 0) + 10;

  const adicionar = (c: Catalogo) => rodar(supabase.from("kpis").insert({
    catalogo_chave: c.chave, nome: c.nome, descricao: c.descricao, unidade: c.unidade, sentido: c.sentido, ordem: proxOrdem(),
  }));

  async function criarLivre() {
    if (!livre.nome.trim()) { setErro("Dê um nome ao indicador."); return; }
    if (await rodar(supabase.from("kpis").insert({
      catalogo_chave: null, nome: livre.nome.trim(), descricao: livre.descricao.trim() || null,
      unidade: livre.unidade, sentido: livre.sentido, ordem: proxOrdem(),
    }))) setLivre({ nome: "", descricao: "", unidade: "numero", sentido: "maior" });
  }

  async function mover(k: Kpi, dir: -1 | 1) {
    const lista = [...kpis];
    const i = lista.findIndex((x) => x.id === k.id), j = i + dir;
    if (j < 0 || j >= lista.length) return;
    await rodar(supabase.from("kpis").update({ ordem: lista[j].ordem }).eq("id", k.id));
    await rodar(supabase.from("kpis").update({ ordem: k.ordem === lista[j].ordem ? k.ordem + dir : k.ordem }).eq("id", lista[j].id));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link href="/gestao/indicadores" className="text-xs text-brand-700 hover:underline">← Indicadores</Link>
        <h1 className="text-xl font-bold text-gray-900">⚙️ Configurar indicadores</h1>
        <p className="text-sm text-gray-500">Poucos e certos: cada indicador precisa levar a uma decisão. De 3 a 5 é o ideal.</p>
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      <section className="card p-4">
        <h2 className="font-semibold text-gray-800">Tipo de negócio desta empresa</h2>
        <p className="text-xs text-gray-400">Serve para sugerir os indicadores certos do catálogo.</p>
        <select className="inp mt-2 max-w-xs" value={segmento}
          onChange={(e) => { const s = e.target.value as Segmento; setSegmento(s); rodar(supabase.rpc("kpi_definir_segmento", { p_segmento: s || null })); }}>
          <option value="">Escolha…</option>
          {SEGMENTOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold text-gray-800">Acompanhando ({ativos.length})</h2>
        {ativos.length > DOSE_MAXIMA && (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            ⚠ {ativos.length} indicadores ativos. Mais de {DOSE_MAXIMA}, ninguém acompanha — considere desativar os que não levam a decisão.
          </p>
        )}
        {kpis.length === 0 && <p className="mt-2 text-sm text-gray-400">Nenhum ainda — adicione abaixo.</p>}
        <div className="mt-2 divide-y">
          {kpis.map((k, i) => (
            <div key={k.id} className={`flex flex-wrap items-center gap-2 py-2 text-sm ${k.ativo ? "" : "text-gray-400"}`}>
              <span className="flex flex-col">
                <button className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30" disabled={i === 0} onClick={() => mover(k, -1)} aria-label="Subir">▲</button>
                <button className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30" disabled={i === kpis.length - 1} onClick={() => mover(k, 1)} aria-label="Descer">▼</button>
              </span>
              <span className="min-w-0 flex-1">
                <b className={k.ativo ? "text-gray-900" : ""}>{k.nome}</b>
                <span className="ml-2 text-xs text-gray-400">{k.catalogo_chave ? "catálogo" : "livre · manual"}</span>
              </span>
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={k.ativo} onChange={(e) => rodar(supabase.from("kpis").update({ ativo: e.target.checked }).eq("id", k.id))} />
                ativo
              </label>
              <button className="text-xs text-red-500 hover:underline"
                onClick={() => confirm(`Remover "${k.nome}" e todo o histórico dele? Para só pausar, desmarque "ativo".`) && rodar(supabase.from("kpis").delete().eq("id", k.id))}>
                remover
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-gray-800">Catálogo {segmento && !todos ? `— ${SEGMENTOS.find((s) => s.key === segmento)?.label} + comuns` : ""}</h2>
          <label className="flex items-center gap-1 text-xs text-gray-500"><input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> mostrar todos</label>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {sugeridos.map((c) => (
            <div key={c.chave} className="rounded-lg border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <b className="text-gray-900">{c.nome}</b>
                {usados.has(c.chave)
                  ? <span className="text-xs text-green-700">✓ adicionado</span>
                  : <button className="btn-ghost px-2 py-0.5 text-xs ring-1 ring-gray-200" onClick={() => adicionar(c)}>+ Adicionar</button>}
              </div>
              <p className="mt-1 text-xs text-gray-600">{c.descricao}</p>
              <p className="mt-1 text-[11px] text-gray-400">
                {c.sentido === "maior" ? "↑ maior é melhor" : "↓ menor é melhor"} · {c.coleta === "automatico" ? "automático" : "manual"}
                {c.financeiro ? " · financeiro (responsável da gerência)" : ""}
              </p>
              {c.aviso && <p className="mt-1 text-[11px] text-amber-700">⚠ {c.aviso}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="font-semibold text-gray-800">Indicador livre (manual)</h2>
        <p className="text-xs text-gray-400">Para algo que o catálogo não tem. O responsável lança o valor todo mês.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <div className="sm:col-span-2"><label className="lbl">Nome</label><input className="inp" value={livre.nome} onChange={(e) => setLivre({ ...livre, nome: e.target.value })} placeholder="Ex.: Satisfação do cliente" /></div>
          <div>
            <label className="lbl">Unidade</label>
            <select className="inp" value={livre.unidade} onChange={(e) => setLivre({ ...livre, unidade: e.target.value as Unidade })}>
              {UNIDADES.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
            </select>
          </div>
          <div>
            <label className="lbl">Sentido</label>
            <select className="inp" value={livre.sentido} onChange={(e) => setLivre({ ...livre, sentido: e.target.value as Sentido })}>
              <option value="maior">↑ maior é melhor</option>
              <option value="menor">↓ menor é melhor</option>
            </select>
          </div>
          <div className="sm:col-span-4"><label className="lbl">Que pergunta ele responde / que decisão apoia?</label><input className="inp" value={livre.descricao} onChange={(e) => setLivre({ ...livre, descricao: e.target.value })} /></div>
        </div>
        <div className="mt-2 flex justify-end"><button className="btn-primary text-sm" onClick={criarLivre}>Criar indicador</button></div>
      </section>
    </div>
  );
}
