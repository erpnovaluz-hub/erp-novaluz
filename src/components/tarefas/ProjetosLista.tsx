"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CORES, type Projeto } from "@/lib/tarefas";
import { Avatar, useEquipe } from "@/components/tarefas/comum";
import { useAcesso } from "@/components/AcessoProvider";
import { hojeISO } from "@/lib/tarefas";

type Contagem = Record<string, { abertas: number; total: number; atrasadas: number }>;

export default function ProjetosLista() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { porId } = useEquipe();
  const { gerencia } = useAcesso();
  const [modelos, setModelos] = useState<{ id: string; nome: string }[]>([]);
  const [modeloId, setModeloId] = useState("");
  const [dataBase, setDataBase] = useState(hojeISO());
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [cont, setCont] = useState<Contagem>({});
  const [verArquivados, setVerArquivados] = useState(false);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cor, setCor] = useState("teal");
  const [privado, setPrivado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const [p, t] = await Promise.all([
      supabase.from("projetos").select("*").order("nome"),
      supabase.from("tarefas").select("projeto_id, concluida, prazo").not("projeto_id", "is", null).is("parent_id", null).range(0, 9999),
    ]);
    if (p.error) setErro(p.error.message);
    setProjetos((p.data ?? []) as Projeto[]);
    const c: Contagem = {};
    for (const r of (t.data ?? []) as any[]) {
      const x = (c[r.projeto_id] ??= { abertas: 0, total: 0, atrasadas: 0 });
      x.total++;
      if (!r.concluida) { x.abertas++; if (r.prazo && r.prazo < hoje) x.atrasadas++; }
    }
    setCont(c);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    supabase.from("modelos_projeto").select("id, nome").order("nome").then(({ data }) => setModelos(data ?? []));
  }, [supabase]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (modeloId) {
      const { data, error } = await supabase.rpc("criar_projeto_de_modelo", {
        p_modelo: modeloId, p_nome: nome.trim(), p_privado: privado, p_data_base: dataBase || hojeISO(), p_cor: cor,
      });
      if (error) { setErro(error.message); return; }
      router.push(`/tarefas/projetos/${data}`);
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("projetos")
      .insert({ nome: nome.trim(), descricao: descricao.trim() || null, cor, privado, dono_id: user?.id })
      .select("id").single();
    if (error) { setErro(error.message); return; }
    router.push(`/tarefas/projetos/${data.id}`);
  }

  const visiveis = projetos.filter((p) => p.arquivado === verArquivados);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📁 Projetos</h1>
          <p className="text-sm text-gray-500">Projetos abertos são vistos por todos. 🔒 Privados: só você e a gerência.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tarefas" className="btn-ghost text-sm ring-1 ring-gray-200">✅ Minhas tarefas</Link>
          <Link href="/tarefas/modelos" className="btn-ghost text-sm ring-1 ring-gray-200">🧩 Modelos</Link>
          {gerencia && <Link href="/tarefas/automacoes" className="btn-ghost text-sm ring-1 ring-gray-200">⚙️ Automações</Link>}
          <button className="btn-primary text-sm" onClick={() => setCriando(true)}>+ Novo projeto</button>
        </div>
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {criando && (
        <form onSubmit={criar} className="card space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <input autoFocus required className="inp" placeholder="Nome do projeto (ex.: Mobilização obra Vale)" value={nome} onChange={(e) => setNome(e.target.value)} />
            <input className="inp" placeholder="Descrição (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          {modelos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select className="inp w-64 py-1" value={modeloId} onChange={(e) => setModeloId(e.target.value)}>
                <option value="">Projeto em branco</option>
                {modelos.map((m) => <option key={m.id} value={m.id}>🧩 {m.nome}</option>)}
              </select>
              {modeloId && (
                <label className="flex items-center gap-2 text-gray-600">
                  início <input type="date" className="inp py-1" value={dataBase} onChange={(e) => setDataBase(e.target.value)} />
                </label>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              {Object.entries(CORES).map(([k, hex]) => (
                <button type="button" key={k} onClick={() => setCor(k)} aria-label={k}
                  className={`h-6 w-6 rounded-full ${cor === k ? "ring-2 ring-offset-2" : ""}`} style={{ background: hex, ["--tw-ring-color" as any]: hex }} />
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={privado} onChange={(e) => setPrivado(e.target.checked)} />
              🔒 Privado (só eu e a gerência)
            </label>
            <div className="ml-auto flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => setCriando(false)}>Cancelar</button>
              <button className="btn-primary" disabled={!nome.trim()}>Criar projeto</button>
            </div>
          </div>
        </form>
      )}

      {visiveis.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-400">
          {verArquivados ? "Nenhum projeto arquivado." : "Nenhum projeto ainda. Crie o primeiro!"}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map((p) => {
            const c = cont[p.id] ?? { abertas: 0, total: 0, atrasadas: 0 };
            const pct = c.total ? Math.round(((c.total - c.abertas) / c.total) * 100) : 0;
            return (
              <Link key={p.id} href={`/tarefas/projetos/${p.id}`} className="card block p-4 transition hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white" style={{ background: CORES[p.cor] ?? CORES.teal }}>
                    {p.nome.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{p.privado && "🔒 "}{p.nome}</p>
                    <p className="truncate text-xs text-gray-500">{p.descricao || "—"}</p>
                  </div>
                  <Avatar pessoa={p.dono_id ? porId[p.dono_id] : null} size={22} />
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                  <span>{c.abertas} aberta(s){c.atrasadas > 0 && <span className="text-red-600"> · {c.atrasadas} atrasada(s)</span>}</span>
                  <span>{pct}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                  <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: CORES[p.cor] ?? CORES.teal }} />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <button className="text-xs text-gray-500 hover:underline" onClick={() => setVerArquivados((v) => !v)}>
        {verArquivados ? "← Voltar aos projetos ativos" : "Ver projetos arquivados"}
      </button>
    </div>
  );
}
