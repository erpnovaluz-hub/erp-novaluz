"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { formatDateTime } from "@/lib/format";
import { AUTOMACOES, type Gatilho, type Projeto } from "@/lib/tarefas";
import { Avatar, useEquipe } from "@/components/tarefas/comum";

type Config = {
  gatilho: Gatilho; ativo: boolean; responsavel_id: string | null; projeto_id: string | null;
  modelo_id: string | null; prazo_dias: number; parametro_dias: number;
};
const PADRAO: Omit<Config, "gatilho"> = { ativo: false, responsavel_id: null, projeto_id: null, modelo_id: null, prazo_dias: 2, parametro_dias: 3 };

// Gerência liga/desliga o que o ERP transforma em tarefa, e para quem vai.
export default function AutomacoesView() {
  const supabase = useMemo(() => createClient(), []);
  const { empresaId } = useAcesso();
  const { pessoas, porId } = useEquipe();
  const [cfg, setCfg] = useState<Record<string, Config>>({});
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [modelos, setModelos] = useState<{ id: string; nome: string }[]>([]);
  const [ultima, setUltima] = useState<{ ultima_execucao: string; criadas: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [rodando, setRodando] = useState(false);

  const carregar = useCallback(async () => {
    const [a, p, m, u] = await Promise.all([
      supabase.from("automacoes_tarefa").select("*"),
      supabase.from("projetos").select("*").eq("arquivado", false).order("nome"),
      supabase.from("modelos_projeto").select("id, nome").order("nome"),
      supabase.from("automacao_execucoes").select("ultima_execucao, criadas").maybeSingle(),
    ]);
    if (a.error) setMsg({ ok: false, texto: a.error.message });
    setCfg(Object.fromEntries(((a.data ?? []) as Config[]).map((c) => [c.gatilho, c])));
    setProjetos((p.data ?? []) as Projeto[]);
    setModelos(m.data ?? []);
    setUltima(u.data as any);
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvar(g: Gatilho, campos: Partial<Config>) {
    const atual = { ...PADRAO, ...cfg[g], gatilho: g, ...campos };
    if (atual.ativo && !atual.responsavel_id) {
      setMsg({ ok: false, texto: "Escolha um responsável antes de ligar a automação." });
      return;
    }
    setCfg((c) => ({ ...c, [g]: atual }));
    const { error } = await supabase.from("automacoes_tarefa").upsert(
      { ...atual, empresa_consultora_id: empresaId, atualizado_em: new Date().toISOString() },
      { onConflict: "empresa_consultora_id,gatilho" });
    if (error) { setMsg({ ok: false, texto: error.message }); carregar(); return; }
    setMsg({ ok: true, texto: "Salvo." });
    setTimeout(() => setMsg(null), 2000);
  }

  async function rodarAgora() {
    setRodando(true);
    const { data, error } = await supabase.rpc("rodar_automacoes", { p_forcar: true });
    setRodando(false);
    if (error) { setMsg({ ok: false, texto: error.message }); return; }
    setMsg({ ok: true, texto: `Verificação concluída: ${data ?? 0} tarefa(s) nova(s).` });
    carregar();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">⚙️ Automações de tarefas</h1>
          <p className="text-sm text-gray-500">O ERP cria a tarefa sozinho e entrega para a pessoa certa.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tarefas/projetos" className="btn-ghost text-sm ring-1 ring-gray-200">📁 Projetos</Link>
          <button className="btn-primary text-sm" onClick={rodarAgora} disabled={rodando}>
            {rodando ? "Verificando…" : "▶ Verificar rotinas agora"}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        <b>Eventos</b> criam a tarefa na hora. <b>Rotinas</b> rodam 1× por dia, quando alguém abre o painel
        {ultima && <> · última verificação: {formatDateTime(ultima.ultima_execucao)} ({ultima.criadas} criada(s))</>}.
      </p>

      {msg && <div className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.texto}</div>}

      <div className="space-y-3">
        {AUTOMACOES.map((a) => {
          const c = { ...PADRAO, ...cfg[a.gatilho] };
          return (
            <div key={a.gatilho} className={`card p-4 ${c.ativo ? "ring-1 ring-brand-300" : ""}`}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">{a.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">
                    {a.titulo}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${a.tipo === "evento" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>{a.tipo}</span>
                  </p>
                  <p className="text-sm text-gray-500"><b>Quando:</b> {a.quando}</p>
                  <p className="text-sm text-gray-500"><b>Cria:</b> {a.cria}</p>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={c.ativo} onChange={(e) => salvar(a.gatilho, { ativo: e.target.checked })} />
                  {c.ativo ? <span className="font-medium text-green-700">Ligada</span> : <span className="text-gray-400">Desligada</span>}
                </label>
              </div>

              <div className="mt-3 grid gap-3 border-t pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className="text-xs text-gray-500">Responsável</span>
                  <div className="mt-1 flex items-center gap-2">
                    <Avatar pessoa={c.responsavel_id ? porId[c.responsavel_id] : null} size={22} />
                    <select className="inp w-full py-1" value={c.responsavel_id ?? ""} onChange={(e) => salvar(a.gatilho, { responsavel_id: e.target.value || null })}>
                      <option value="">— escolher —</option>
                      {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
                    </select>
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">Colocar no projeto</span>
                  <select className="inp mt-1 w-full py-1" value={c.projeto_id ?? ""} onChange={(e) => salvar(a.gatilho, { projeto_id: e.target.value || null })}>
                    <option value="">— tarefa pessoal do responsável —</option>
                    {projetos.map((p) => <option key={p.id} value={p.id}>{p.privado ? "🔒 " : ""}{p.nome}</option>)}
                  </select>
                </label>
                {a.parametro ? (
                  <label className="block">
                    <span className="text-xs text-gray-500">Avisar com</span>
                    <div className="mt-1 flex items-center gap-2">
                      <input type="number" min={0} max={365} className="inp w-20 py-1" value={c.parametro_dias}
                        onChange={(e) => salvar(a.gatilho, { parametro_dias: Math.max(0, Number(e.target.value) || 0) })} />
                      <span className="text-xs text-gray-500">{a.parametro}</span>
                    </div>
                  </label>
                ) : a.usaModelo ? (
                  <label className="block">
                    <span className="text-xs text-gray-500">Checklist (modelo)</span>
                    <select className="inp mt-1 w-full py-1" value={c.modelo_id ?? ""} onChange={(e) => salvar(a.gatilho, { modelo_id: e.target.value || null })}>
                      <option value="">— sem checklist —</option>
                      {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                  </label>
                ) : <span />}
                {/* estes usam a própria data (vencimento / devolução / manutenção) como prazo */}
                {!["titulo_vencendo", "ferramenta_atrasada", "manutencao_ferramenta"].includes(a.gatilho) && (
                  <label className="block">
                    <span className="text-xs text-gray-500">Prazo da tarefa</span>
                    <div className="mt-1 flex items-center gap-2">
                      <input type="number" min={0} max={365} className="inp w-20 py-1" value={c.prazo_dias}
                        onChange={(e) => salvar(a.gatilho, { prazo_dias: Math.max(0, Number(e.target.value) || 0) })} />
                      <span className="text-xs text-gray-500">{a.gatilho === "os_aberta" ? "dias (se a OS não tiver prazo)" : "dias"}</span>
                    </div>
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400">
        Tarefas automáticas aparecem como criadas por “Automação”. Para o checklist da OS, monte um projeto com as etapas e use
        “Salvar como modelo” — veja em <Link href="/tarefas/modelos" className="text-brand-600 hover:underline">Modelos</Link>.
      </p>
    </div>
  );
}
