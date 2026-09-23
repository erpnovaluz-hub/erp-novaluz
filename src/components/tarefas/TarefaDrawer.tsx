"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { podeArea } from "@/lib/permissoes";
import { formatDateTime } from "@/lib/format";
import {
  PRIORIDADES, VINCULOS, vinculoDef, corPrazo, rotuloPrazo,
  type Projeto, type Secao, type Tarefa, type VinculoTipo,
} from "@/lib/tarefas";
import { Avatar, Check, useEquipe } from "@/components/tarefas/comum";
import TarefaAnexos from "@/components/tarefas/TarefaAnexos";
import TarefaComentarios from "@/components/tarefas/TarefaComentarios";

// Painel lateral da tarefa: tudo salva na hora (sem botão "salvar").
export default function TarefaDrawer({ tarefaId, onClose, onChange }: {
  tarefaId: string; onClose: () => void; onChange: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const { pessoas, porId } = useEquipe();
  const [t, setT] = useState<Tarefa | null>(null);
  const [subs, setSubs] = useState<Tarefa[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [secoes, setSecoes] = useState<Secao[]>([]);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [novaSub, setNovaSub] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [vinculando, setVinculando] = useState(false);

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from("tarefas").select("*").eq("id", tarefaId).maybeSingle(),
      supabase.from("tarefas").select("*").eq("parent_id", tarefaId).order("ordem").order("criado_em"),
    ]);
    if (!a.data) { setErro("Tarefa não encontrada ou sem acesso."); return; }
    setT(a.data as Tarefa); setTitulo(a.data.titulo); setDescricao(a.data.descricao ?? "");
    setSubs((b.data ?? []) as Tarefa[]);
  }, [supabase, tarefaId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    supabase.from("projetos").select("*").eq("arquivado", false).order("nome").then(({ data }) => setProjetos((data ?? []) as Projeto[]));
  }, [supabase]);
  useEffect(() => {
    if (!t?.projeto_id) { setSecoes([]); return; }
    supabase.from("secoes_projeto").select("*").eq("projeto_id", t.projeto_id).order("ordem")
      .then(({ data }) => setSecoes((data ?? []) as Secao[]));
  }, [supabase, t?.projeto_id]);

  // fecha com Esc
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);

  async function salvar(campos: Partial<Tarefa>) {
    if (!t) return;
    setT({ ...t, ...campos });
    const { error } = await supabase.from("tarefas").update(campos).eq("id", t.id);
    if (error) { setErro(error.message); carregar(); return; }
    setErro(null);
    onChange();
  }

  async function moverProjeto(projetoId: string) {
    if (!t) return;
    let secao: string | null = null;
    if (projetoId) {
      const { data } = await supabase.from("secoes_projeto").select("id").eq("projeto_id", projetoId).order("ordem").limit(1);
      secao = data?.[0]?.id ?? null;
    }
    // subtarefas acompanham a tarefa-mãe
    if (subs.length) await supabase.from("tarefas").update({ projeto_id: projetoId || null }).eq("parent_id", t.id);
    await salvar({ projeto_id: projetoId || null, secao_id: secao });
  }

  async function addSub(e: React.FormEvent) {
    e.preventDefault();
    if (!t || !novaSub.trim()) return;
    const { error } = await supabase.from("tarefas").insert({
      titulo: novaSub.trim(), parent_id: t.id, projeto_id: t.projeto_id, ordem: Date.now(),
    });
    if (error) { setErro(error.message); return; }
    setNovaSub(""); carregar(); onChange();
  }

  async function toggleSub(s: Tarefa) {
    await supabase.from("tarefas").update({ concluida: !s.concluida }).eq("id", s.id);
    carregar(); onChange();
  }

  async function excluirSub(s: Tarefa) {
    await supabase.from("tarefas").delete().eq("id", s.id);
    carregar(); onChange();
  }

  async function excluir() {
    if (!t || !confirm(`Excluir a tarefa "${t.titulo}"${subs.length ? " e suas subtarefas" : ""}?`)) return;
    const { error } = await supabase.from("tarefas").delete().eq("id", t.id);
    if (error) { setErro(error.message); return; }
    onChange(); onClose();
  }

  const vinc = vinculoDef(t?.vinculo_tipo);
  const podeAbrirVinculo = vinc ? podeArea(acesso, vinc.modulo) : false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          {t ? (
            <button className={`btn-ghost text-sm ring-1 ${t.concluida ? "bg-green-50 text-green-700 ring-green-200" : "ring-gray-200"}`}
              onClick={() => salvar({ concluida: !t.concluida })}>
              {t.concluida ? "✓ Concluída" : "✓ Marcar como concluída"}
            </button>
          ) : <span />}
          <div className="flex items-center gap-1">
            {t && <button className="btn-ghost text-sm text-red-500" onClick={excluir}>Excluir</button>}
            <button className="btn-ghost text-lg leading-none" onClick={onClose} aria-label="Fechar">×</button>
          </div>
        </div>

        {erro && <div className="mx-5 mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</div>}

        {!t ? (
          <div className="p-8 text-center text-sm text-gray-400">{erro ? "" : "Carregando…"}</div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <textarea
              className={`w-full resize-none rounded-lg border-0 px-1 text-xl font-semibold focus:ring-2 focus:ring-brand-500 ${t.concluida ? "text-gray-400 line-through" : "text-gray-900"}`}
              rows={2} value={titulo} onChange={(e) => setTitulo(e.target.value)}
              onBlur={() => titulo.trim() && titulo !== t.titulo && salvar({ titulo: titulo.trim() })} />

            <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3 text-sm">
              <span className="text-gray-500">Responsável</span>
              <div className="flex items-center gap-2">
                <Avatar pessoa={t.responsavel_id ? porId[t.responsavel_id] : null} />
                <select className="inp py-1" value={t.responsavel_id ?? ""} onChange={(e) => salvar({ responsavel_id: e.target.value || null })}>
                  <option value="">Sem responsável</option>
                  {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
                </select>
              </div>

              <span className="text-gray-500">Prazo</span>
              <div className="flex items-center gap-2">
                <input type="date" className="inp py-1" value={t.prazo ?? ""} onChange={(e) => salvar({ prazo: e.target.value || null })} />
                {t.prazo && <span className={`text-xs ${corPrazo(t.prazo, t.concluida)}`}>{rotuloPrazo(t.prazo)}</span>}
              </div>

              <span className="text-gray-500">Prioridade</span>
              <select className="inp w-40 py-1" value={t.prioridade} onChange={(e) => salvar({ prioridade: e.target.value as Tarefa["prioridade"] })}>
                {PRIORIDADES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>

              {!t.parent_id && (
                <>
                  <span className="text-gray-500">Projeto</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="inp py-1" value={t.projeto_id ?? ""} onChange={(e) => moverProjeto(e.target.value)}>
                      <option value="">— Tarefa pessoal —</option>
                      {projetos.map((p) => <option key={p.id} value={p.id}>{p.privado ? "🔒 " : ""}{p.nome}</option>)}
                    </select>
                    {t.projeto_id && secoes.length > 0 && (
                      <select className="inp py-1" value={t.secao_id ?? ""} onChange={(e) => salvar({ secao_id: e.target.value || null })}>
                        {secoes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                      </select>
                    )}
                  </div>
                </>
              )}

              <span className="text-gray-500">Vinculada a</span>
              <div>
                {vinc && t.vinculo_id ? (
                  <div className="flex items-center gap-2">
                    {podeAbrirVinculo ? (
                      <Link href={vinc.href(t.vinculo_id)} className="rounded-md bg-brand-50 px-2 py-1 text-brand-700 hover:underline">
                        {vinc.icon} {t.vinculo_rotulo || vinc.label}
                      </Link>
                    ) : (
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-gray-600" title="Seu perfil não acessa este módulo">
                        {vinc.icon} {t.vinculo_rotulo || vinc.label}
                      </span>
                    )}
                    <button className="text-xs text-gray-400 hover:text-red-500"
                      onClick={() => salvar({ vinculo_tipo: null, vinculo_id: null, vinculo_rotulo: null })}>remover</button>
                  </div>
                ) : vinculando ? (
                  <VinculoPicker onEscolher={(tipo, id, rotulo) => { setVinculando(false); salvar({ vinculo_tipo: tipo, vinculo_id: id, vinculo_rotulo: rotulo }); }}
                    onCancelar={() => setVinculando(false)} />
                ) : (
                  <button className="text-brand-600 hover:underline" onClick={() => setVinculando(true)}>+ Vincular a OS, cliente, requisição…</button>
                )}
              </div>
            </div>

            <div>
              <p className="mb-1 text-sm text-gray-500">Descrição</p>
              <textarea className="inp min-h-[100px] w-full" placeholder="Detalhes, contexto, o que precisa ser feito…"
                value={descricao} onChange={(e) => setDescricao(e.target.value)}
                onBlur={() => descricao !== (t.descricao ?? "") && salvar({ descricao: descricao || null })} />
            </div>

            {!t.parent_id && (
              <div>
                <p className="mb-1 text-sm text-gray-500">
                  Subtarefas {subs.length > 0 && <span className="text-gray-400">· {subs.filter((s) => s.concluida).length}/{subs.length}</span>}
                </p>
                <ul className="divide-y rounded-lg border">
                  {subs.map((s) => (
                    <li key={s.id} className="group flex items-center gap-2 px-3 py-2 text-sm">
                      <Check feito={s.concluida} onClick={() => toggleSub(s)} size={16} />
                      <span className={`flex-1 ${s.concluida ? "text-gray-400 line-through" : "text-gray-800"}`}>{s.titulo}</span>
                      {s.responsavel_id && <Avatar pessoa={porId[s.responsavel_id]} size={20} />}
                      <button className="text-xs text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100" onClick={() => excluirSub(s)}>excluir</button>
                    </li>
                  ))}
                  <li>
                    <form onSubmit={addSub} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="text-gray-300">+</span>
                      <input className="flex-1 border-0 p-1 text-sm focus:ring-0" placeholder="Adicionar subtarefa (Enter)"
                        value={novaSub} onChange={(e) => setNovaSub(e.target.value)} />
                    </form>
                  </li>
                </ul>
              </div>
            )}

            <TarefaAnexos tarefaId={t.id} porId={porId} />

            <div className="border-t pt-4">
              <TarefaComentarios tarefaId={t.id} pessoas={pessoas} porId={porId} />
            </div>

            <p className="border-t pt-3 text-xs text-gray-400">
              Criada por {(t.criado_por && (porId[t.criado_por]?.nome || porId[t.criado_por]?.email)) || "—"} em {formatDateTime(t.criado_em)}
              {t.concluida_em && <> · concluída em {formatDateTime(t.concluida_em)}</>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Busca um registro do ERP para vincular (só nos módulos que o perfil enxerga).
function VinculoPicker({ onEscolher, onCancelar }: {
  onEscolher: (tipo: VinculoTipo, id: string, rotulo: string) => void; onCancelar: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const tipos = VINCULOS.filter((v) => podeArea(acesso, v.modulo));
  const [tipo, setTipo] = useState<VinculoTipo>(tipos[0]?.tipo ?? "os");
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState<any[]>([]);
  const def = vinculoDef(tipo)!;

  useEffect(() => {
    let vivo = true;
    const h = setTimeout(async () => {
      let q = supabase.from(def.tabela).select(def.colunas).order(def.ordem, { ascending: false }).limit(20);
      if (busca.trim()) q = q.ilike(def.busca, `%${busca.trim()}%`);
      const { data } = await q;
      if (vivo) setItens(data ?? []);
    }, 250);
    return () => { vivo = false; clearTimeout(h); };
  }, [supabase, def, busca]);

  if (tipos.length === 0) return <span className="text-gray-400">Seu perfil não tem módulos para vincular.</span>;

  return (
    <div className="space-y-2 rounded-lg border p-2">
      <div className="flex gap-2">
        <select className="inp py-1" value={tipo} onChange={(e) => { setTipo(e.target.value as VinculoTipo); setBusca(""); }}>
          {tipos.map((v) => <option key={v.tipo} value={v.tipo}>{v.icon} {v.label}</option>)}
        </select>
        <input autoFocus className="inp flex-1 py-1" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="btn-ghost text-xs" onClick={onCancelar}>cancelar</button>
      </div>
      <ul className="max-h-56 overflow-y-auto text-sm">
        {itens.length === 0 ? <li className="px-2 py-3 text-center text-gray-400">Nada encontrado.</li> : itens.map((r) => (
          <li key={r.id}>
            <button className="w-full rounded px-2 py-1.5 text-left hover:bg-gray-100" onClick={() => onEscolher(tipo, r.id, def.rotulo(r))}>
              {def.rotulo(r) || "(sem nome)"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
