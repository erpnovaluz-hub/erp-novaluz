"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { formatDate } from "@/lib/format";
import { normalizar } from "@/lib/planilha";
import { CATEGORIAS, STATUS_FERR, catLabel, type Ferramenta } from "@/lib/ferramentas";
import FerramentaForm from "@/components/ferramentas/FerramentaForm";
import ImportarFerramentas from "@/components/ferramentas/ImportarFerramentas";
import LeitorQr from "@/components/ferramentas/LeitorQr";

type Aba = "todas" | "em_uso" | "atencao";
const DEST_ICON: Record<string, string> = { os: "🧷", obra: "🏗️", setor: "🏷️" };
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// "Onde está?": todas as ferramentas, quem está com cada uma e o que precisa de atenção.
export default function FerramentasPainel() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const podeEditar = usePode("estoque", "editar");
  const [lista, setLista] = useState<Ferramenta[]>([]);
  const [aba, setAba] = useState<Aba>("todas");
  const [busca, setBusca] = useState("");
  const [cat, setCat] = useState("");
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [novo, setNovo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("vw_ferramentas_local").select("*").order("codigo").range(0, 9999);
    setLista((data ?? []) as Ferramenta[]);
    setCarregando(false);
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  const hoje = hojeISO();
  const em30 = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
  const ativas = lista.filter((f) => f.status !== "baixada");
  const kpi = {
    total: ativas.length,
    disponiveis: lista.filter((f) => f.status === "disponivel").length,
    emUso: lista.filter((f) => f.status === "em_uso").length,
    atrasadas: lista.filter((f) => f.atrasada).length,
    manutencao: lista.filter((f) => f.status === "manutencao").length,
    manutVencendo: ativas.filter((f) => f.proxima_manutencao && f.proxima_manutencao <= em30 && f.status !== "manutencao").length,
    extraviadas: lista.filter((f) => f.status === "extraviada").length,
  };

  const filtradas = useMemo(() => {
    const q = normalizar(busca);
    return lista.filter((f) =>
      (aba === "todas" ? (status ? f.status === status : f.status !== "baixada")
        : aba === "em_uso" ? f.status === "em_uso"
        : f.atrasada || f.status === "manutencao" || f.status === "extraviada" || (!!f.proxima_manutencao && f.proxima_manutencao <= em30 && f.status !== "baixada"))
      && (!cat || f.categoria === cat)
      && (!q || [f.codigo, f.descricao, f.marca, f.modelo, f.numero_serie, f.com_colaborador_nome, f.destino_nome].some((x) => normalizar(x).includes(q))));
  }, [lista, aba, busca, cat, status, em30]);

  // em uso: agrupado por quem está com a ferramenta
  const porPessoa = useMemo(() => {
    const m = new Map<string, Ferramenta[]>();
    for (const f of filtradas) { const k = f.com_colaborador_nome ?? "—"; m.set(k, [...(m.get(k) ?? []), f]); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtradas]);

  const lido = useCallback(async (codigo: string) => {
    setLendo(false);
    const f = lista.find((x) => x.codigo === codigo);
    if (f) router.push(`/estoque/ferramentas/${f.id}`);
    else setMsg(`Código ${codigo} não encontrado.`);
  }, [lista, router]);

  function alternar(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const selDisponiveis = lista.filter((f) => sel.has(f.id) && f.status === "disponivel");

  const Linha = ({ f }: { f: Ferramenta }) => (
    <div className="linha-lista flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
      {podeEditar && (
        <input type="checkbox" className="h-4 w-4 shrink-0 rounded border-gray-300" checked={sel.has(f.id)} onChange={() => alternar(f.id)} aria-label={`Selecionar ${f.codigo}`} />
      )}
      <Link href={`/estoque/ferramentas/${f.id}`} className="linha-principal min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900"><span className="mr-2 font-mono text-xs text-gray-500">{f.codigo}</span>{f.descricao}</p>
        <p className="truncate text-xs text-gray-400">
          {[catLabel(f.categoria), [f.marca, f.modelo].filter(Boolean).join(" "), f.status === "em_uso" ? null : f.deposito_nome].filter(Boolean).join(" · ")}
        </p>
      </Link>
      {f.status === "em_uso" ? (
        <div className="w-56 shrink-0 text-right text-xs">
          <p className="truncate font-medium text-gray-700">👷 {f.com_colaborador_nome ?? "—"}</p>
          <p className={`truncate ${f.atrasada ? "font-medium text-red-600" : "text-gray-400"}`}>
            {f.destino_nome ? `${DEST_ICON[f.destino_tipo ?? ""] ?? ""} ${f.destino_nome}` : ""}
            {f.previsao_devolucao ? ` · até ${formatDate(f.previsao_devolucao)}` : ""}{f.atrasada ? " ⚠" : ""}
          </p>
        </div>
      ) : f.proxima_manutencao && f.proxima_manutencao <= em30 && f.status !== "manutencao" ? (
        <div className={`w-40 shrink-0 text-right text-xs ${f.proxima_manutencao < hoje ? "font-medium text-red-600" : "text-amber-700"}`}>🛠️ manut. {formatDate(f.proxima_manutencao)}</div>
      ) : <div className="w-40 shrink-0" />}
      <div className="w-28 shrink-0 text-right"><Badge value={f.status} options={STATUS_FERR} /></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">🔧 Ferramentas e equipamentos</h1>
          <p className="text-sm text-gray-500">Onde está cada uma, com quem, e o que precisa de atenção.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => setLendo(true)}>📷 Ler etiqueta</button>
          {podeEditar && <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => setImportando(true)}>📥 Importar planilha</button>}
          {podeEditar && <button className="btn-primary text-sm" onClick={() => setNovo(true)}>+ Nova</button>}
        </div>
      </div>

      {msg && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi t="Ativas" v={kpi.total} />
        <Kpi t="Disponíveis" v={kpi.disponiveis} cor="text-green-700" />
        <Kpi t="Em uso" v={kpi.emUso} cor="text-blue-700" />
        <Kpi t="Devolução atrasada" v={kpi.atrasadas} cor={kpi.atrasadas ? "text-red-600" : undefined} alerta={kpi.atrasadas > 0} />
        <Kpi t="Em manutenção" v={kpi.manutencao} cor={kpi.manutencao ? "text-amber-700" : undefined} />
        <Kpi t="Manutenção em 30 dias" v={kpi.manutVencendo} cor={kpi.manutVencendo ? "text-amber-700" : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-2">
        <div className="abas-rolaveis flex gap-1">
          {([["todas", "Todas"], ["em_uso", `Em uso (${kpi.emUso})`], ["atencao", `Atenção (${kpi.atrasadas + kpi.manutencao + kpi.manutVencendo + kpi.extraviadas})`]] as [Aba, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`rounded-full px-3 py-1 text-sm ${aba === k ? "bg-brand-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200"}`}>{l}</button>
          ))}
        </div>
        <input className="inp w-full py-1.5 sm:ml-auto sm:w-56" placeholder="Buscar código, nome, pessoa, obra…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className="inp w-full py-1.5 sm:w-44" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Todas as categorias</option>
          {CATEGORIAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        {aba === "todas" && (
          <select className="inp w-full py-1.5 sm:w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Status (ativas)</option>
            {STATUS_FERR.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
      </div>

      {sel.size > 0 && (
        <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white md:top-2">
          <span>{sel.size} selecionada(s)</span>
          <button className="rounded-lg bg-white px-3 py-1 font-medium text-gray-900 disabled:opacity-40" disabled={selDisponiveis.length === 0}
            onClick={() => router.push(`/estoque/cautela/nova?f=${selDisponiveis.map((f) => f.id).join(",")}`)}>
            📤 Cautelar {selDisponiveis.length !== sel.size ? `(${selDisponiveis.length} disponível(is))` : ""}
          </button>
          <button className="rounded-lg bg-white/15 px-3 py-1" onClick={() => router.push(`/estoque/ferramentas/etiquetas?ids=${Array.from(sel).join(",")}`)}>🏷️ Etiquetas</button>
          <button className="ml-auto text-white/70" onClick={() => setSel(new Set())}>limpar</button>
        </div>
      )}

      {carregando ? <p className="py-10 text-center text-sm text-gray-400">Carregando…</p>
        : filtradas.length === 0 ? (
          <div className="card p-10 text-center text-sm text-gray-400">
            {lista.length === 0 ? "Nenhuma ferramenta cadastrada. Use “+ Nova” ou “📥 Importar planilha”." : "Nada neste filtro."}
          </div>
        ) : aba === "em_uso" ? (
          porPessoa.map(([pessoa, fs]) => (
            <section key={pessoa}>
              <h2 className="mb-1 text-sm font-semibold text-gray-700">👷 {pessoa} <span className="text-xs font-normal text-gray-400">· {fs.length}</span></h2>
              <div className="card divide-y divide-gray-100 overflow-hidden">{fs.map((f) => <Linha key={f.id} f={f} />)}</div>
            </section>
          ))
        ) : (
          <div className="card divide-y divide-gray-100 overflow-hidden">{filtradas.map((f) => <Linha key={f.id} f={f} />)}</div>
        )}

      {podeEditar && lista.length > 0 && (
        <div className="flex flex-wrap gap-4 text-xs">
          <button className="text-brand-600 hover:underline" onClick={() => setSel(new Set(filtradas.map((f) => f.id)))}>selecionar as {filtradas.length} da lista</button>
          <Link href="/estoque/cautela" className="text-brand-600 hover:underline">📋 ver cautelas</Link>
        </div>
      )}

      {novo && <FerramentaForm registro={null} onFechar={() => setNovo(false)} onSalvo={(id) => router.push(`/estoque/ferramentas/${id}`)} />}
      {importando && <ImportarFerramentas onFechar={() => setImportando(false)} onImportado={(t) => { setImportando(false); setMsg(t); carregar(); }} />}
      {lendo && <LeitorQr onLido={lido} onFechar={() => setLendo(false)} />}
    </div>
  );
}

function Kpi({ t, v, cor, alerta }: { t: string; v: number; cor?: string; alerta?: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-gray-500">{t}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${cor ?? "text-gray-900"}`}>{alerta && "⚠ "}{v}</p>
    </div>
  );
}
