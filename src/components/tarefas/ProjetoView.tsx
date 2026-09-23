"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { CORES, PRIORIDADES, corPrazo, rotuloPrazo, vinculoDef, type Projeto, type Secao, type Tarefa } from "@/lib/tarefas";
import { Avatar, Check, useEquipe } from "@/components/tarefas/comum";
import TarefaLinha from "@/components/tarefas/TarefaLinha";
import TarefaDrawer from "@/components/tarefas/TarefaDrawer";
import CalendarioTarefas from "@/components/tarefas/CalendarioTarefas";

type Visao = "lista" | "quadro" | "calendario";
const SEM_SECAO = "__sem__";

export default function ProjetoView({ projetoId }: { projetoId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const acesso = useAcesso();
  const { pessoas, porId } = useEquipe();
  const [projeto, setProjeto] = useState<Projeto | null>(null);
  const [secoes, setSecoes] = useState<Secao[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [visao, setVisao] = useState<Visao>("lista");
  const [filtroResp, setFiltroResp] = useState("");
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  // visão preferida fica no navegador
  useEffect(() => {
    try { const v = localStorage.getItem("tarefas.visao"); if (v === "lista" || v === "quadro" || v === "calendario") setVisao(v); } catch {}
  }, []);
  function trocarVisao(v: Visao) { setVisao(v); try { localStorage.setItem("tarefas.visao", v); } catch {} }

  const carregar = useCallback(async () => {
    const [p, s, t] = await Promise.all([
      supabase.from("projetos").select("*").eq("id", projetoId).maybeSingle(),
      supabase.from("secoes_projeto").select("*").eq("projeto_id", projetoId).order("ordem"),
      supabase.from("vw_tarefas").select("*").eq("projeto_id", projetoId).is("parent_id", null).order("ordem").order("criado_em"),
    ]);
    setProjeto(p.data as Projeto | null);
    setSecoes((s.data ?? []) as Secao[]);
    setTarefas((t.data ?? []) as Tarefa[]);
    setCarregando(false);
  }, [supabase, projetoId]);

  useEffect(() => { carregar(); }, [carregar]);

  const podeGerir = !!projeto && (acesso.gerencia || projeto.dono_id === acesso.userId);

  const visiveis = useMemo(() => tarefas.filter((t) =>
    (mostrarConcluidas || !t.concluida) && (!filtroResp || (filtroResp === "ninguem" ? !t.responsavel_id : t.responsavel_id === filtroResp)),
  ), [tarefas, mostrarConcluidas, filtroResp]);

  // colunas = seções (+ "Sem seção" se houver tarefa órfã)
  const colunas = useMemo(() => {
    const cols = secoes.map((s) => ({ id: s.id, nome: s.nome, secao: s as Secao | null }));
    if (tarefas.some((t) => !t.secao_id || !secoes.find((s) => s.id === t.secao_id))) cols.push({ id: SEM_SECAO, nome: "Sem seção", secao: null });
    return cols;
  }, [secoes, tarefas]);
  const daColuna = (colId: string) => visiveis.filter((t) =>
    colId === SEM_SECAO ? !t.secao_id || !secoes.find((s) => s.id === t.secao_id) : t.secao_id === colId);

  async function toggle(t: Tarefa) {
    setTarefas((l) => l.map((x) => (x.id === t.id ? { ...x, concluida: !x.concluida } : x)));
    await supabase.from("tarefas").update({ concluida: !t.concluida }).eq("id", t.id);
    carregar();
  }

  async function novaTarefa(secaoId: string | null, titulo: string) {
    const { error } = await supabase.from("tarefas").insert({
      titulo, projeto_id: projetoId, secao_id: secaoId === SEM_SECAO ? null : secaoId, ordem: Date.now(),
      responsavel_id: filtroResp && filtroResp !== "ninguem" ? filtroResp : null,
    });
    if (error) { setErro(error.message); return; }
    carregar();
  }

  async function mover(tarefaId: string, secaoId: string) {
    const destino = secaoId === SEM_SECAO ? null : secaoId;
    setTarefas((l) => l.map((x) => (x.id === tarefaId ? { ...x, secao_id: destino, ordem: Date.now() } : x)));
    const { error } = await supabase.from("tarefas").update({ secao_id: destino, ordem: Date.now() }).eq("id", tarefaId);
    if (error) setErro(error.message);
    carregar();
  }

  async function mudarPrazo(tarefaId: string, prazo: string | null) {
    setTarefas((l) => l.map((x) => (x.id === tarefaId ? { ...x, prazo } : x)));
    const { error } = await supabase.from("tarefas").update({ prazo }).eq("id", tarefaId);
    if (error) setErro(error.message);
    carregar();
  }

  async function addSecao() {
    const nome = window.prompt("Nome da nova seção:");
    if (!nome?.trim()) return;
    const ordem = Math.max(0, ...secoes.map((s) => s.ordem)) + 1;
    const { error } = await supabase.from("secoes_projeto").insert({ projeto_id: projetoId, nome: nome.trim(), ordem });
    if (error) { setErro(error.message); return; }
    carregar();
  }

  async function renomearSecao(s: Secao) {
    const nome = window.prompt("Renomear seção:", s.nome);
    if (!nome?.trim() || nome === s.nome) return;
    await supabase.from("secoes_projeto").update({ nome: nome.trim() }).eq("id", s.id);
    carregar();
  }

  async function excluirSecao(s: Secao) {
    const n = tarefas.filter((t) => t.secao_id === s.id).length;
    if (!confirm(`Excluir a seção "${s.nome}"?${n ? ` As ${n} tarefa(s) dela vão para "Sem seção".` : ""}`)) return;
    await supabase.from("secoes_projeto").delete().eq("id", s.id);
    carregar();
  }

  async function atualizarProjeto(campos: Partial<Projeto>) {
    const { error } = await supabase.from("projetos").update(campos).eq("id", projetoId);
    if (error) { setErro(error.message); return; }
    carregar();
  }

  async function renomearProjeto() {
    if (!projeto) return;
    const nome = window.prompt("Nome do projeto:", projeto.nome);
    if (nome?.trim() && nome !== projeto.nome) atualizarProjeto({ nome: nome.trim() });
  }

  async function salvarComoModelo() {
    if (!projeto) return;
    const nome = window.prompt("Nome do modelo:", projeto.nome);
    if (!nome?.trim()) return;
    const { error } = await supabase.rpc("salvar_projeto_como_modelo", { p_projeto: projetoId, p_nome: nome.trim() });
    if (error) { setErro(error.message); return; }
    if (confirm("Modelo salvo. Abrir a lista de modelos?")) router.push("/tarefas/modelos");
  }

  async function excluirProjeto() {
    if (!projeto || !confirm(`Excluir o projeto "${projeto.nome}" e TODAS as suas tarefas? Isso não pode ser desfeito. (Prefira arquivar.)`)) return;
    const { error } = await supabase.from("projetos").delete().eq("id", projetoId);
    if (error) { setErro(error.message); return; }
    router.push("/tarefas/projetos");
  }

  if (carregando) return <div className="p-8 text-center text-sm text-gray-400">Carregando…</div>;
  if (!projeto) return (
    <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-gray-500">
      Projeto não encontrado ou privado. <Link href="/tarefas/projetos" className="text-brand-600 hover:underline">Voltar</Link>
    </div>
  );

  const cor = CORES[projeto.cor] ?? CORES.teal;
  const abertas = tarefas.filter((t) => !t.concluida).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/tarefas/projetos" className="hover:text-gray-700">Projetos</Link> <span>/</span> <span className="text-gray-600">{projeto.nome}</span>
      </div>

      {/* cabeçalho */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl text-xl font-bold text-white" style={{ background: cor }}>
          {projeto.nome.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
            {projeto.privado && <span title="Privado: só o dono e a gerência">🔒</span>}
            {projeto.nome}
            {projeto.arquivado && <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-normal text-gray-600">arquivado</span>}
          </h1>
          <p className="text-sm text-gray-500">
            {abertas} aberta(s) de {tarefas.length}
            {projeto.dono_id && porId[projeto.dono_id] && <> · dono: {porId[projeto.dono_id].nome || porId[projeto.dono_id].email}</>}
            {projeto.descricao && <> · {projeto.descricao}</>}
          </p>
        </div>
        <button className="btn-ghost text-sm" onClick={salvarComoModelo} title="Copia seções e tarefas para reutilizar">🧩 Salvar como modelo</button>
        {podeGerir && (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <button className="btn-ghost" onClick={renomearProjeto}>Renomear</button>
            <button className="btn-ghost" onClick={() => atualizarProjeto({ privado: !projeto.privado })}>
              {projeto.privado ? "🔓 Tornar aberto" : "🔒 Tornar privado"}
            </button>
            <button className="btn-ghost" onClick={() => atualizarProjeto({ arquivado: !projeto.arquivado })}>
              {projeto.arquivado ? "Desarquivar" : "Arquivar"}
            </button>
            <button className="btn-ghost text-red-500" onClick={excluirProjeto}>Excluir</button>
          </div>
        )}
      </div>

      {/* barra: visão + filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
        <div className="flex gap-1">
          {([["lista", "☰ Lista"], ["quadro", "▦ Quadro"], ["calendario", "📅 Calendário"]] as [Visao, string][]).map(([k, l]) => (
            <button key={k} onClick={() => trocarVisao(k)}
              className={`rounded-md px-3 py-1.5 text-sm ${visao === k ? "bg-brand-50 font-medium text-brand-700" : "text-gray-500 hover:bg-gray-100"}`}>{l}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select className="inp py-1" value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)}>
            <option value="">Todos os responsáveis</option>
            <option value="ninguem">Sem responsável</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={mostrarConcluidas} onChange={(e) => setMostrarConcluidas(e.target.checked)} /> Mostrar concluídas
          </label>
          <button className="btn-ghost text-brand-600" onClick={addSecao}>+ Seção</button>
        </div>
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {visao === "lista" ? (
        <div className="space-y-5">
          {colunas.map((c) => {
            const itens = daColuna(c.id);
            return (
              <section key={c.id}>
                <CabecalhoSecao nome={c.nome} qtd={itens.length} secao={c.secao} onRenomear={renomearSecao} onExcluir={excluirSecao} />
                <div className="card overflow-hidden">
                  {itens.map((t) => (
                    <TarefaLinha key={t.id} t={t} pessoa={t.responsavel_id ? porId[t.responsavel_id] : null}
                      onAbrir={() => setAberta(t.id)} onToggle={() => toggle(t)} />
                  ))}
                  <NovaTarefaInline onCriar={(titulo) => novaTarefa(c.id, titulo)} />
                </div>
              </section>
            );
          })}
        </div>
      ) : visao === "calendario" ? (
        <CalendarioTarefas tarefas={visiveis} porId={porId} onAbrir={setAberta} onMudarPrazo={mudarPrazo} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {colunas.map((c) => (
            <ColunaQuadro key={c.id} colId={c.id} nome={c.nome} secao={c.secao} itens={daColuna(c.id)}
              porId={porId} onAbrir={setAberta} onToggle={toggle} onMover={mover}
              onCriar={(titulo) => novaTarefa(c.id, titulo)} onRenomear={renomearSecao} onExcluir={excluirSecao} />
          ))}
        </div>
      )}

      {aberta && <TarefaDrawer tarefaId={aberta} onClose={() => setAberta(null)} onChange={carregar} />}
    </div>
  );
}

function CabecalhoSecao({ nome, qtd, secao, onRenomear, onExcluir }: {
  nome: string; qtd: number; secao: Secao | null; onRenomear: (s: Secao) => void; onExcluir: (s: Secao) => void;
}) {
  return (
    <div className="group mb-1 flex items-center gap-2">
      <h2 className="text-sm font-semibold text-gray-700">{nome}</h2>
      <span className="text-xs text-gray-400">{qtd}</span>
      {secao && (
        <span className="ml-1 hidden gap-2 text-xs group-hover:flex">
          <button className="text-gray-400 hover:text-gray-700" onClick={() => onRenomear(secao)}>renomear</button>
          <button className="text-gray-400 hover:text-red-500" onClick={() => onExcluir(secao)}>excluir</button>
        </span>
      )}
    </div>
  );
}

function NovaTarefaInline({ onCriar }: { onCriar: (titulo: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onCriar(v.trim()); setV(""); } }}
      className="flex items-center gap-2 px-3 py-1.5">
      <span className="text-gray-300">+</span>
      <input className="flex-1 border-0 p-1 text-sm focus:ring-0" placeholder="Adicionar tarefa… (Enter)" value={v} onChange={(e) => setV(e.target.value)} />
    </form>
  );
}

function ColunaQuadro({ colId, nome, secao, itens, porId, onAbrir, onToggle, onMover, onCriar, onRenomear, onExcluir }: {
  colId: string; nome: string; secao: Secao | null; itens: Tarefa[]; porId: Record<string, any>;
  onAbrir: (id: string) => void; onToggle: (t: Tarefa) => void; onMover: (tarefaId: string, colId: string) => void;
  onCriar: (titulo: string) => void; onRenomear: (s: Secao) => void; onExcluir: (s: Secao) => void;
}) {
  const [sobre, setSobre] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => { e.preventDefault(); setSobre(false); const id = e.dataTransfer.getData("text/tarefa"); if (id) onMover(id, colId); }}
      className={`flex w-72 shrink-0 flex-col rounded-xl p-2 transition ${sobre ? "bg-brand-50 ring-2 ring-brand-300" : "bg-gray-100"}`}>
      <div className="px-1 pb-2"><CabecalhoSecao nome={nome} qtd={itens.length} secao={secao} onRenomear={onRenomear} onExcluir={onExcluir} /></div>
      <div className="flex flex-col gap-2">
        {itens.map((t) => {
          const vinc = vinculoDef(t.vinculo_tipo);
          return (
            <div key={t.id} draggable
              onDragStart={(e) => { e.dataTransfer.setData("text/tarefa", t.id); e.dataTransfer.effectAllowed = "move"; }}
              onClick={() => onAbrir(t.id)}
              className="cursor-pointer rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm hover:border-gray-300 hover:shadow">
              <div className="flex items-start gap-2">
                <Check feito={t.concluida} onClick={() => onToggle(t)} size={16} />
                <p className={`flex-1 ${t.concluida ? "text-gray-400 line-through" : "text-gray-800"}`}>{t.titulo}</p>
              </div>
              {vinc && <p className="mt-2 truncate text-[11px] text-gray-500">{vinc.icon} {t.vinculo_rotulo || vinc.label}</p>}
              <div className="mt-2 flex items-center gap-2">
                {t.prioridade !== "media" && <Badge value={t.prioridade} options={PRIORIDADES} />}
                {(t.n_sub ?? 0) > 0 && <span className="text-[11px] text-gray-400">☑ {t.n_sub_ok}/{t.n_sub}</span>}
                <span className={`ml-auto text-[11px] ${corPrazo(t.prazo, t.concluida)}`}>{rotuloPrazo(t.prazo)}</span>
                <Avatar pessoa={t.responsavel_id ? porId[t.responsavel_id] : null} size={20} />
              </div>
            </div>
          );
        })}
        <div className="rounded-lg bg-white/60"><NovaTarefaInline onCriar={onCriar} /></div>
      </div>
    </div>
  );
}
