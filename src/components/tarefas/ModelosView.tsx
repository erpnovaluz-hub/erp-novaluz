"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { PRIORIDADES, hojeISO } from "@/lib/tarefas";

type Modelo = { id: string; nome: string; descricao: string | null; criado_por: string | null };
type ItemModelo = { id: string; modelo_id: string; secao: string; titulo: string; prioridade: string; dias_prazo: number | null; ordem: number };

// Modelos = projetos-receita. Servem para criar projeto pronto e de checklist da OS.
export default function ModelosView() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { userId, gerencia } = useAcesso();
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [itens, setItens] = useState<ItemModelo[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");

  const carregar = useCallback(async () => {
    const [m, i] = await Promise.all([
      supabase.from("modelos_projeto").select("*").order("nome"),
      supabase.from("modelos_tarefa").select("*").order("ordem"),
    ]);
    if (m.error) setErro(m.error.message);
    setModelos((m.data ?? []) as Modelo[]);
    setItens((i.data ?? []) as ItemModelo[]);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criarModelo(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.from("modelos_projeto").insert({ nome: novoNome.trim(), criado_por: userId }).select("id").single();
    if (error) { setErro(error.message); return; }
    setNovoNome(""); setAberto(data.id); carregar();
  }

  async function usar(m: Modelo) {
    const nome = window.prompt("Nome do novo projeto:", m.nome);
    if (!nome?.trim()) return;
    const base = window.prompt("Data de início (os prazos contam a partir dela) — AAAA-MM-DD:", hojeISO());
    if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(base)) return;
    const { data, error } = await supabase.rpc("criar_projeto_de_modelo", { p_modelo: m.id, p_nome: nome.trim(), p_data_base: base });
    if (error) { setErro(error.message); return; }
    router.push(`/tarefas/projetos/${data}`);
  }

  async function renomear(m: Modelo) {
    const nome = window.prompt("Nome do modelo:", m.nome);
    if (!nome?.trim() || nome === m.nome) return;
    const { error } = await supabase.from("modelos_projeto").update({ nome: nome.trim() }).eq("id", m.id);
    if (error) setErro(error.message);
    carregar();
  }

  async function excluir(m: Modelo) {
    if (!confirm(`Excluir o modelo "${m.nome}"? Projetos já criados com ele não mudam.`)) return;
    const { error } = await supabase.from("modelos_projeto").delete().eq("id", m.id);
    if (error) setErro(error.message);
    carregar();
  }

  async function addItem(m: Modelo, secao: string, titulo: string, dias: string) {
    const ordem = Math.max(0, ...itens.filter((i) => i.modelo_id === m.id).map((i) => i.ordem)) + 1;
    const { error } = await supabase.from("modelos_tarefa").insert({
      modelo_id: m.id, secao: secao.trim() || "A fazer", titulo: titulo.trim(), ordem,
      dias_prazo: dias === "" ? null : Number(dias),
    });
    if (error) setErro(error.message);
    carregar();
  }

  async function removerItem(i: ItemModelo) {
    const { error } = await supabase.from("modelos_tarefa").delete().eq("id", i.id);
    if (error) setErro(error.message);
    carregar();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">🧩 Modelos de projeto</h1>
          <p className="text-sm text-gray-500">Receitas de projeto e checklists (ex.: mobilização de obra, checklist da OS).</p>
        </div>
        <Link href="/tarefas/projetos" className="btn-ghost text-sm ring-1 ring-gray-200">📁 Projetos</Link>
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      <form onSubmit={criarModelo} className="card flex flex-wrap items-center gap-2 p-2">
        <span className="pl-2 text-gray-300">+</span>
        <input className="min-w-[200px] flex-1 border-0 p-1.5 text-sm focus:ring-0" placeholder="Novo modelo em branco (ex.: Checklist de OS)"
          value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
        <button className="btn-primary text-sm" disabled={!novoNome.trim()}>Criar</button>
      </form>
      <p className="-mt-3 text-xs text-gray-400">Dica: dentro de um projeto, “Salvar como modelo” copia as seções e tarefas dele.</p>

      {modelos.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-400">Nenhum modelo ainda.</div>
      ) : modelos.map((m) => {
        const lista = itens.filter((i) => i.modelo_id === m.id);
        const podeEditar = gerencia || m.criado_por === userId;
        const secoes = Array.from(new Set(lista.map((i) => i.secao)));
        return (
          <div key={m.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <button className="flex-1 text-left" onClick={() => setAberto(aberto === m.id ? null : m.id)}>
                <p className="font-semibold text-gray-900">{aberto === m.id ? "▾" : "▸"} {m.nome}</p>
                <p className="text-xs text-gray-500">{lista.length} tarefa(s) · {secoes.length} seção(ões)</p>
              </button>
              <button className="btn-primary text-sm" onClick={() => usar(m)} disabled={lista.length === 0}>Usar modelo</button>
              {podeEditar && <button className="btn-ghost text-sm" onClick={() => renomear(m)}>Renomear</button>}
              {podeEditar && <button className="btn-ghost text-sm text-red-500" onClick={() => excluir(m)}>Excluir</button>}
            </div>
            {aberto === m.id && (
              <div className="border-t bg-gray-50 p-4">
                {secoes.map((s) => (
                  <div key={s} className="mb-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{s}</p>
                    <ul className="divide-y rounded-lg border bg-white">
                      {lista.filter((i) => i.secao === s).map((i) => (
                        <li key={i.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="flex-1 text-gray-800">{i.titulo}</span>
                          {i.prioridade !== "media" && <Badge value={i.prioridade} options={PRIORIDADES} />}
                          <span className="w-24 text-right text-xs text-gray-500">{i.dias_prazo == null ? "sem prazo" : `dia +${i.dias_prazo}`}</span>
                          {podeEditar && <button className="text-xs text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100" onClick={() => removerItem(i)}>excluir</button>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {podeEditar && <NovoItem secoes={secoes} onAdd={(s, t, d) => addItem(m, s, t, d)} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NovoItem({ secoes, onAdd }: { secoes: string[]; onAdd: (secao: string, titulo: string, dias: string) => void }) {
  const [secao, setSecao] = useState(secoes[0] ?? "A fazer");
  const [titulo, setTitulo] = useState("");
  const [dias, setDias] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (titulo.trim()) { onAdd(secao, titulo, dias); setTitulo(""); setDias(""); } }}
      className="flex flex-wrap items-center gap-2">
      <input className="inp w-40 py-1 text-sm" list="secoes-modelo" placeholder="Seção" value={secao} onChange={(e) => setSecao(e.target.value)} />
      <datalist id="secoes-modelo">{secoes.map((s) => <option key={s} value={s} />)}</datalist>
      <input className="inp min-w-[180px] flex-1 py-1 text-sm" placeholder="Tarefa do modelo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
      <input type="number" min={0} className="inp w-24 py-1 text-sm" placeholder="dia +N" value={dias} onChange={(e) => setDias(e.target.value)} title="Prazo: dias a partir da data de início" />
      <button className="btn-primary py-1 text-sm" disabled={!titulo.trim()}>+ Adicionar</button>
    </form>
  );
}
