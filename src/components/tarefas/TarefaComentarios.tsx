"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { formatDateTime } from "@/lib/format";
import type { Pessoa } from "@/lib/tarefas";
import { Avatar } from "@/components/tarefas/comum";

type Comentario = { id: string; autor_id: string | null; texto: string; mencoes: string[]; criado_em: string };

const nomeMencao = (p: Pessoa) => (p.nome || p.email || "").trim();

// Conversa da tarefa. Digite @ para marcar alguém (vai para a caixa de entrada).
export default function TarefaComentarios({ tarefaId, pessoas, porId }: {
  tarefaId: string; pessoas: Pessoa[]; porId: Record<string, Pessoa>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { userId, gerencia } = useAcesso();
  const [lista, setLista] = useState<Comentario[]>([]);
  const [texto, setTexto] = useState("");
  const [mencionados, setMencionados] = useState<Set<string>>(new Set());
  const [sugestao, setSugestao] = useState<{ termo: string; inicio: number } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("tarefa_comentarios").select("id, autor_id, texto, mencoes, criado_em")
      .eq("tarefa_id", tarefaId).order("criado_em");
    setLista((data ?? []) as Comentario[]);
  }, [supabase, tarefaId]);

  useEffect(() => { carregar(); }, [carregar]);

  // detecta "@termo" logo antes do cursor
  function aoDigitar(v: string, cursor: number) {
    setTexto(v);
    const m = /(^|\s)@([^\s@]*)$/.exec(v.slice(0, cursor));
    setSugestao(m ? { termo: m[2].toLowerCase(), inicio: cursor - m[2].length - 1 } : null);
  }

  const opcoes = sugestao
    ? pessoas.filter((p) => p.id !== userId && nomeMencao(p).toLowerCase().includes(sugestao.termo)).slice(0, 6)
    : [];

  function mencionar(p: Pessoa) {
    if (!sugestao) return;
    const cursor = ref.current?.selectionStart ?? texto.length;
    const novo = `${texto.slice(0, sugestao.inicio)}@${nomeMencao(p)} ${texto.slice(cursor)}`;
    setTexto(novo);
    setMencionados((s) => new Set(s).add(p.id));
    setSugestao(null);
    requestAnimationFrame(() => ref.current?.focus());
  }

  async function enviar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!texto.trim() || enviando) return;
    // só vale a menção que continua escrita no texto
    const mencoes = [...mencionados].filter((id) => porId[id] && texto.includes(`@${nomeMencao(porId[id])}`));
    setEnviando(true);
    const { error } = await supabase.from("tarefa_comentarios").insert({ tarefa_id: tarefaId, texto: texto.trim(), mencoes, autor_id: userId });
    setEnviando(false);
    if (error) { setErro(error.message); return; }
    setTexto(""); setMencionados(new Set()); setErro(null);
    carregar();
  }

  async function excluir(c: Comentario) {
    if (!confirm("Excluir este comentário?")) return;
    await supabase.from("tarefa_comentarios").delete().eq("id", c.id);
    carregar();
  }

  // destaca @Nome das pessoas mencionadas
  function renderTexto(c: Comentario) {
    const nomes = c.mencoes.map((id) => porId[id]).filter(Boolean).map((p) => `@${nomeMencao(p!)}`);
    if (nomes.length === 0) return c.texto;
    const re = new RegExp(`(${nomes.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
    return c.texto.split(re).map((parte, i) =>
      nomes.includes(parte) ? <span key={i} className="rounded bg-brand-50 px-0.5 font-medium text-brand-700">{parte}</span> : parte);
  }

  return (
    <div>
      <p className="mb-2 text-sm text-gray-500">Comentários {lista.length > 0 && <span className="text-gray-400">· {lista.length}</span>}</p>
      <ul className="space-y-3">
        {lista.map((c) => {
          const autor = c.autor_id ? porId[c.autor_id] : null;
          return (
            <li key={c.id} className="group flex gap-2">
              <Avatar pessoa={autor} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500">
                  <b className="text-gray-700">{autor?.nome || autor?.email || "—"}</b> · {formatDateTime(c.criado_em)}
                  {(c.autor_id === userId || gerencia) && (
                    <button className="ml-2 text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100" onClick={() => excluir(c)}>excluir</button>
                  )}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-800">{renderTexto(c)}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}

      <form onSubmit={enviar} className="relative mt-3">
        <textarea ref={ref} rows={2} className="inp w-full pr-20"
          placeholder="Escreva um comentário… use @ para marcar alguém (Ctrl+Enter envia)"
          value={texto}
          onChange={(e) => aoDigitar(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (opcoes.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); mencionar(opcoes[0]); return; }
            if (e.key === "Escape" && sugestao) { e.stopPropagation(); setSugestao(null); return; }
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar();
          }} />
        <button className="btn-primary absolute bottom-2 right-2 py-1 text-xs" disabled={!texto.trim() || enviando}>Enviar</button>
        {opcoes.length > 0 && (
          <ul className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-lg border bg-white shadow-lg">
            {opcoes.map((p, i) => (
              <li key={p.id}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); mencionar(p); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 ${i === 0 ? "bg-gray-50" : ""}`}>
                  <Avatar pessoa={p} size={20} /> {nomeMencao(p)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}
