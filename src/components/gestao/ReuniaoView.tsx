"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { Avatar, useEquipe } from "@/components/tarefas/comum";
import TarefaDrawer from "@/components/tarefas/TarefaDrawer";
import KpisForaDaFaixa from "@/components/gestao/KpisForaDaFaixa";
import { formatDateTime } from "@/lib/format";
import { nomeCurto, rotuloPrazo, hojeISO, type Pessoa } from "@/lib/tarefas";
import {
  SITUACOES, STATUS_ENC, STATUS_REUNIAO, TIPOS, dataHoraCurta, dataLonga, paraInputDataHora, tipoLabel,
  type Decisao, type Encaminhamento, type ItemPauta, type Parte, type Participante, type Presenca,
  type Reuniao, type Revisao, type SituacaoRevisao,
} from "@/lib/ritmo";

type Dados = {
  r: Reuniao; part: Participante[]; pauta: ItemPauta[]; dec: Decisao[];
  enc: Encaminhamento[]; pend: Encaminhamento[]; rev: Revisao[];
};
type Aba = "pauta" | "ata" | "acomp";

// /gestao/reunioes/[id] — a vida da reunião em 3 abas:
// Pauta (antes) → Ata (durante: presença, pendências, pauta, decisões,
// encaminhamentos) → Acompanhamento (depois: ciência e status).
export default function ReuniaoView({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const acesso = useAcesso();
  const { pessoas, porId } = useEquipe();
  const [d, setD] = useState<Dados | null>(null);
  const [naoAchou, setNaoAchou] = useState(false);
  const [aba, setAba] = useState<Aba | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [tarefa, setTarefa] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  const carregar = useCallback(async () => {
    const { data: r } = await supabase.from("reunioes").select("*").eq("id", id).maybeSingle();
    if (!r) { setNaoAchou(true); return; }
    const [part, pauta, dec, enc, pendIds, rev] = await Promise.all([
      supabase.from("reuniao_participantes").select("*").eq("reuniao_id", id),
      supabase.from("reuniao_pauta").select("*").eq("reuniao_id", id).order("ordem").order("criado_em"),
      supabase.from("reuniao_decisoes").select("*").eq("reuniao_id", id).order("ordem").order("criado_em"),
      supabase.from("vw_encaminhamentos").select("*").eq("reuniao_id", id).order("ordem").order("criado_em"),
      supabase.rpc("ritmo_pendencias", { p_reuniao: id }),
      supabase.from("reuniao_revisoes").select("*").eq("reuniao_id", id),
    ]);
    const ids = ((pendIds.data ?? []) as { encaminhamento_id: string }[]).map((x) => x.encaminhamento_id);
    const pend = ids.length
      ? ((await supabase.from("vw_encaminhamentos").select("*").in("id", ids)).data ?? []) as Encaminhamento[]
      : [];
    pend.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    const dados: Dados = {
      r: r as Reuniao, part: (part.data ?? []) as Participante[], pauta: (pauta.data ?? []) as ItemPauta[],
      dec: (dec.data ?? []) as Decisao[], enc: (enc.data ?? []) as Encaminhamento[], pend, rev: (rev.data ?? []) as Revisao[],
    };
    setD(dados);
    setAba((a) => a ?? (dados.r.status === "realizada" ? "acomp" : dados.r.status === "em_andamento" ? "ata" : "pauta"));
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  // executa uma escrita; mostra o erro do banco (mensagens das RPCs são em português)
  async function rodar(fn: () => PromiseLike<{ error: any }>, ok?: string) {
    setErro(null); setAviso(null);
    const { error } = await fn();
    if (error) { setErro(error.message); return false; }
    if (ok) setAviso(ok);
    await carregar();
    return true;
  }

  if (naoAchou) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-6 text-center">
        <p className="text-3xl">🔒</p>
        <h1 className="mt-2 text-lg font-semibold text-gray-800">Reunião não encontrada</h1>
        <p className="mt-1 text-sm text-gray-500">Ela não existe ou é confidencial e você não está na lista de participantes.</p>
        <Link href="/gestao" className="btn-primary mt-4 inline-block">Voltar</Link>
      </div>
    );
  }
  if (!d || !aba) return <p className="p-8 text-center text-sm text-gray-400">Carregando…</p>;

  const { r } = d;
  const gerir = !!acesso.conduz;
  const editavel = gerir && (r.status === "agendada" || r.status === "em_andamento");
  const eu = d.part.find((p) => p.perfil_id === acesso.userId);
  const precisaCiencia = r.status === "realizada" && eu?.presenca === "presente" && !eu.ciencia_em;
  const nome = (pid: string | null | undefined) => (pid && (porId[pid]?.nome || porId[pid]?.email)) || "—";

  async function fecharAta() {
    if (!confirm("Fechar a ata? Os encaminhamentos viram tarefas e os presentes são avisados. Depois de fechada, a ata não muda (só reabrindo, com motivo).")) return;
    setErro(null); setAviso(null);
    const { data, error } = await supabase.rpc("ritmo_fechar_ata", { p_reuniao: id });
    if (error) { setErro(error.message); return; }
    setAviso(`Ata fechada. ${(data as any)?.tarefas_criadas ?? 0} tarefa(s) criada(s).`);
    setAba("acomp");
    await carregar();
  }
  async function reabrir() {
    const motivo = prompt("Motivo da reabertura (fica registrado):");
    if (!motivo?.trim()) return;
    await rodar(() => supabase.rpc("ritmo_reabrir_ata", { p_reuniao: id, p_motivo: motivo }), "Ata reaberta.");
    setAba("ata");
  }
  async function excluir() {
    if (!confirm("Excluir esta reunião agendada?")) return;
    const { error } = await supabase.from("reunioes").delete().eq("id", id);
    if (error) { setErro(error.message); return; }
    router.push("/gestao");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/gestao/reunioes" className="text-xs text-brand-700 hover:underline">← Reuniões</Link>

      {/* Cabeçalho */}
      <div className="card mt-1 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{r.titulo}</h1>
              <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_REUNIAO[r.status].cls}`}>{STATUS_REUNIAO[r.status].label}</span>
              {r.confidencial && <span className="rounded bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">🔒 CONFIDENCIAL</span>}
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {tipoLabel(r.tipo)} · {dataHoraCurta(r.data_hora)} · {r.duracao_min} min{r.local ? ` · ${r.local}` : ""}
            </p>
            <p className="text-xs text-gray-500">
              Conduz: {nome(r.conduzida_por)}
              {r.anterior_id && <> · <Link href={`/gestao/reunioes/${r.anterior_id}`} className="text-brand-700 hover:underline">reunião anterior</Link></>}
              {" · "}<i>{TIPOS.find((t) => t.key === r.tipo)?.pergunta}</i>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {precisaCiencia && (
              <button className="btn-primary text-sm" onClick={() => rodar(() => supabase.rpc("ritmo_dar_ciencia", { p_reuniao: id }), "Ciência registrada. Obrigado!")}>
                ✍️ Li e estou ciente
              </button>
            )}
            {gerir && r.status === "agendada" && (
              <button className="btn-primary text-sm" onClick={() => rodar(() => supabase.from("reunioes").update({ status: "em_andamento" }).eq("id", id)).then(() => setAba("ata"))}>
                ▶ Iniciar reunião
              </button>
            )}
            {gerir && r.status === "em_andamento" && <button className="btn-primary text-sm" onClick={fecharAta}>✔ Fechar ata</button>}
            {gerir && r.status === "realizada" && <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={reabrir}>↺ Reabrir ata</button>}
            {gerir && r.status === "cancelada" && (
              <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={() => rodar(() => supabase.from("reunioes").update({ status: "agendada" }).eq("id", id))}>Reativar</button>
            )}
            <Link href={`/gestao/reunioes/${id}/imprimir`} className="btn-ghost text-sm ring-1 ring-gray-200">🖨️ Ata</Link>
            <Link href={`/gestao/chat?sobre=${encodeURIComponent(`Sobre a reunião "${r.titulo}" de ${dataLonga(r.data_hora)}:`)}`} className="btn-ghost text-sm ring-1 ring-gray-200">💬 Pedir ajuda</Link>
            {editavel && <button className="btn-ghost text-sm" onClick={() => setEditando((v) => !v)}>✏️ Editar</button>}
            {gerir && r.status === "agendada" && (
              <button className="btn-ghost text-sm text-gray-500" onClick={() => confirm("Cancelar esta reunião?") && rodar(() => supabase.from("reunioes").update({ status: "cancelada" }).eq("id", id))}>Cancelar</button>
            )}
            {gerir && (r.status === "agendada" || r.status === "cancelada") && <button className="btn-ghost text-sm text-red-500" onClick={excluir}>Excluir</button>}
          </div>
        </div>
        {editando && editavel && <EditarDados r={r} onSalvar={async (campos) => { if (await rodar(() => supabase.from("reunioes").update(campos).eq("id", id))) setEditando(false); }} />}
      </div>

      {erro && <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
      {aviso && <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-700">{aviso}</div>}

      {/* Abas */}
      <div className="abas-rolaveis mt-4 flex gap-1 overflow-x-auto border-b">
        {([["pauta", "📋 Pauta"], ["ata", "📝 Ata"], ["acomp", "📈 Acompanhamento"]] as [Aba, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${aba === k ? "border-brand-600 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {aba === "pauta" && (
          <>
            <Participantes d={d} pessoas={pessoas} porId={porId} editavel={editavel} modo="lista" rodar={rodar} supabase={supabase} />
            {acesso.gerencia && <KpisForaDaFaixa r={r} pauta={d.pauta} editavel={editavel} onLevou={carregar} />}
            <Pauta d={d} porId={porId} editavel={editavel} gerir={gerir} modo="pauta" rodar={rodar} supabase={supabase} />
          </>
        )}
        {aba === "ata" && (
          <>
            {r.status === "agendada" && editavel && (
              <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">A reunião ainda não começou. Clique em <b>▶ Iniciar reunião</b> para conduzir a ata.</p>
            )}
            <Participantes d={d} pessoas={pessoas} porId={porId} editavel={editavel} modo="presenca" rodar={rodar} supabase={supabase} />
            <Pendencias d={d} porId={porId} editavel={editavel} rodar={rodar} supabase={supabase} onAbrir={setTarefa} />
            {acesso.gerencia && editavel && <KpisForaDaFaixa r={r} pauta={d.pauta} editavel={editavel} onLevou={carregar} />}
            <Pauta d={d} porId={porId} editavel={editavel} gerir={gerir} modo="ata" rodar={rodar} supabase={supabase} />
            <Decisoes d={d} editavel={editavel} rodar={rodar} supabase={supabase} />
            <Encaminhamentos d={d} pessoas={pessoas} porId={porId} editavel={editavel} rodar={rodar} supabase={supabase} onAbrir={setTarefa} />
          </>
        )}
        {aba === "acomp" && <Acompanhamento d={d} porId={porId} onAbrir={setTarefa} />}
      </div>

      {tarefa && <TarefaDrawer tarefaId={tarefa} onClose={() => setTarefa(null)} onChange={carregar} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------
type Rodar = (fn: () => PromiseLike<{ error: any }>, ok?: string) => Promise<boolean>;
type Base = { d: Dados; rodar: Rodar; supabase: ReturnType<typeof createClient> };

function Secao({ titulo, dica, children, acao }: { titulo: string; dica?: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-gray-800">{titulo}</h2>
        {acao}
      </div>
      {dica && <p className="mt-0.5 text-xs text-gray-400">{dica}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EditarDados({ r, onSalvar }: { r: Reuniao; onSalvar: (c: Partial<Reuniao>) => void }) {
  const [titulo, setTitulo] = useState(r.titulo);
  const [quando, setQuando] = useState(paraInputDataHora(new Date(r.data_hora)));
  const [duracao, setDuracao] = useState(r.duracao_min);
  const [local, setLocal] = useState(r.local ?? "");
  const [obs, setObs] = useState(r.observacoes ?? "");
  return (
    <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-4">
      <div className="sm:col-span-2"><label className="lbl">Título</label><input className="inp" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
      <div><label className="lbl">Data e hora</label><input type="datetime-local" className="inp" value={quando} onChange={(e) => setQuando(e.target.value)} /></div>
      <div><label className="lbl">Duração (min)</label><input type="number" className="inp" value={duracao} onChange={(e) => setDuracao(Number(e.target.value) || 60)} /></div>
      <div className="sm:col-span-2"><label className="lbl">Local</label><input className="inp" value={local} onChange={(e) => setLocal(e.target.value)} /></div>
      <div className="sm:col-span-2"><label className="lbl">Observações</label><input className="inp" value={obs} onChange={(e) => setObs(e.target.value)} /></div>
      <div className="sm:col-span-4 flex justify-end">
        <button className="btn-primary text-sm" onClick={() => onSalvar({
          titulo: titulo.trim() || r.titulo, data_hora: new Date(quando).toISOString(), duracao_min: duracao,
          local: local.trim() || null, observacoes: obs.trim() || null,
        })}>Salvar</button>
      </div>
    </div>
  );
}

// ---- participantes / presença ------------------------------------------------------
function Participantes({ d, pessoas, porId, editavel, modo, rodar, supabase }: Base & {
  pessoas: Pessoa[]; porId: Record<string, Pessoa>; editavel: boolean; modo: "lista" | "presenca";
}) {
  const [add, setAdd] = useState("");
  const fora = pessoas.filter((p) => !d.part.some((x) => x.perfil_id === p.id));
  const presentes = d.part.filter((p) => p.presenca === "presente").length;
  const setPresenca = (pid: string, presenca: Presenca) =>
    rodar(() => supabase.from("reuniao_participantes").update({ presenca }).match({ reuniao_id: d.r.id, perfil_id: pid }));

  return (
    <Secao titulo={modo === "presenca" ? `1 · Presença (${presentes}/${d.part.length})` : `👥 Participantes (${d.part.length})`}
      dica={modo === "presenca" ? "Marque todos como presente ou ausente — a ata não fecha com alguém só “convidado”." : undefined}
      acao={modo === "presenca" && editavel && d.part.some((p) => p.presenca === "convidado") ? (
        <button className="text-xs text-brand-700 hover:underline"
          onClick={() => rodar(() => supabase.from("reuniao_participantes").update({ presenca: "presente" }).eq("reuniao_id", d.r.id).eq("presenca", "convidado"))}>
          Marcar restantes como presentes
        </button>
      ) : undefined}>
      <div className="flex flex-wrap gap-2">
        {d.part.map((p) => {
          const pessoa = porId[p.perfil_id];
          return (
            <div key={p.perfil_id} className="flex items-center gap-2 rounded-full border bg-white py-1 pl-1 pr-2 text-sm">
              <Avatar pessoa={pessoa} size={24} />
              <span>{pessoa?.nome || pessoa?.email || "Usuário"}</span>
              {modo === "presenca" ? (
                editavel ? (
                  <span className="ml-1 flex overflow-hidden rounded-full ring-1 ring-gray-200">
                    {(["presente", "ausente"] as Presenca[]).map((pr) => (
                      <button key={pr} onClick={() => setPresenca(p.perfil_id, pr)}
                        className={`px-2 py-0.5 text-[11px] ${p.presenca === pr ? (pr === "presente" ? "bg-green-600 text-white" : "bg-gray-500 text-white") : "text-gray-500 hover:bg-gray-50"}`}>
                        {pr === "presente" ? "Presente" : "Ausente"}
                      </button>
                    ))}
                  </span>
                ) : <span className={`text-[11px] ${p.presenca === "presente" ? "text-green-700" : "text-gray-400"}`}>{p.presenca}</span>
              ) : editavel && (
                <button className="text-gray-400 hover:text-red-500" title="Remover"
                  onClick={() => rodar(() => supabase.from("reuniao_participantes").delete().match({ reuniao_id: d.r.id, perfil_id: p.perfil_id }))}>×</button>
              )}
            </div>
          );
        })}
      </div>
      {modo === "lista" && editavel && fora.length > 0 && (
        <div className="mt-3 flex gap-2">
          <select className="inp" value={add} onChange={(e) => setAdd(e.target.value)}>
            <option value="">Adicionar participante…</option>
            {fora.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
          </select>
          <button className="btn-ghost text-sm ring-1 ring-gray-200" disabled={!add}
            onClick={async () => { if (await rodar(() => supabase.from("reuniao_participantes").insert({ reuniao_id: d.r.id, perfil_id: add }))) setAdd(""); }}>
            Adicionar
          </button>
        </div>
      )}
    </Secao>
  );
}

// ---- pendências da anterior ---------------------------------------------------------
function Pendencias({ d, porId, editavel, rodar, supabase, onAbrir }: Base & {
  porId: Record<string, Pessoa>; editavel: boolean; onAbrir: (id: string) => void;
}) {
  if (d.pend.length === 0) {
    return (
      <Secao titulo="2 · Pendências das reuniões anteriores">
        <p className="text-sm text-gray-400">{d.r.anterior_id ? "Nenhuma pendência — tudo resolvido. 👏" : "Primeira reunião da série: não há pendências."}</p>
      </Secao>
    );
  }
  const revisadas = d.pend.filter((e) => d.rev.some((rv) => rv.encaminhamento_id === e.id)).length;
  return (
    <Secao titulo={`2 · Pendências das reuniões anteriores (${revisadas}/${d.pend.length} revisadas)`}
      dica="Para cada uma: feito, não feito (com motivo) ou replanejar (com novo prazo). Quem responde é o dono.">
      <div className="divide-y">
        {d.pend.map((e) => (
          <LinhaPendencia key={e.id} e={e} rev={d.rev.find((rv) => rv.encaminhamento_id === e.id)} dono={porId[e.dono_id]}
            editavel={editavel} onAbrir={onAbrir}
            onSalvar={(rv) => rodar(() => supabase.from("reuniao_revisoes").upsert({ encaminhamento_id: e.id, reuniao_id: d.r.id, ...rv }))}
            onDesfazer={() => rodar(() => supabase.from("reuniao_revisoes").delete().match({ encaminhamento_id: e.id, reuniao_id: d.r.id }))} />
        ))}
      </div>
    </Secao>
  );
}

function LinhaPendencia({ e, rev, dono, editavel, onAbrir, onSalvar, onDesfazer }: {
  e: Encaminhamento; rev?: Revisao; dono?: Pessoa; editavel: boolean; onAbrir: (id: string) => void;
  onSalvar: (rv: { situacao: SituacaoRevisao; motivo: string | null; novo_prazo: string | null }) => void; onDesfazer: () => void;
}) {
  const [sit, setSit] = useState<SituacaoRevisao | null>(null);
  const [motivo, setMotivo] = useState("");
  const [prazo, setPrazo] = useState("");
  const st = STATUS_ENC[e.status ?? "aberto"];
  const precisaMotivo = sit === "nao_feito" || sit === "cancelado";

  function escolher(s: SituacaoRevisao) {
    if (s === "feito") { onSalvar({ situacao: s, motivo: null, novo_prazo: null }); return; }
    setSit(s); setMotivo(""); setPrazo("");
  }

  return (
    <div className="py-3 text-sm">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar pessoa={dono} size={26} />
        <div className="min-w-0 flex-1">
          <button className="text-left font-medium text-gray-900 hover:underline" onClick={() => e.tarefa_id && onAbrir(e.tarefa_id)}>{e.o_que}</button>
          <p className="text-xs text-gray-500">
            {dono?.nome || dono?.email} · prazo {rotuloPrazo(e.prazo_efetivo ?? e.prazo)} · {e.reuniao_titulo} {e.reuniao_data ? dataLonga(e.reuniao_data) : ""}
            {(e.n_sub ?? 0) > 0 && <> · {e.n_sub_ok}/{e.n_sub} partes</>}
          </p>
          <p className="text-xs text-gray-400">Evidência: {e.evidencia}</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{e.tarefa_concluida ? "Tarefa concluída" : st.label}</span>
      </div>
      <div className="mt-2 pl-9">
        {rev ? (
          <p className="text-xs">
            <b className={SITUACOES.find((s) => s.key === rev.situacao)?.key === "feito" ? "text-green-700" : rev.situacao === "nao_feito" ? "text-red-700" : "text-amber-700"}>
              {SITUACOES.find((s) => s.key === rev.situacao)?.label}
            </b>
            {rev.novo_prazo && <> · novo prazo {dataLonga(rev.novo_prazo + "T12:00:00")}</>}
            {rev.motivo && <> · “{rev.motivo}”</>}
            {editavel && <button className="ml-2 text-gray-400 hover:underline" onClick={onDesfazer}>desfazer</button>}
          </p>
        ) : editavel ? (
          sit ? (
            <div className="flex flex-wrap items-center gap-2">
              {sit === "replanejado" && <input type="date" className="inp w-auto" min={hojeISO()} value={prazo} onChange={(x) => setPrazo(x.target.value)} />}
              <input className="inp min-w-[12rem] flex-1" placeholder={precisaMotivo ? "Motivo (obrigatório)" : "Motivo (opcional)"} value={motivo} onChange={(x) => setMotivo(x.target.value)} />
              <button className="btn-primary text-xs" disabled={(precisaMotivo && !motivo.trim()) || (sit === "replanejado" && !prazo)}
                onClick={() => onSalvar({ situacao: sit, motivo: motivo.trim() || null, novo_prazo: sit === "replanejado" ? prazo : null })}>Registrar</button>
              <button className="btn-ghost text-xs" onClick={() => setSit(null)}>×</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {SITUACOES.map((s) => (
                <button key={s.key} onClick={() => escolher(s.key)}
                  className={`rounded-full px-3 py-1 text-xs ring-1 ring-gray-200 hover:opacity-90 ${s.key === "feito" && e.tarefa_concluida ? s.cls : "bg-white text-gray-700"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          )
        ) : <p className="text-xs text-gray-400">Aguardando revisão na reunião.</p>}
      </div>
    </div>
  );
}

// ---- pauta ------------------------------------------------------------------------------
function Pauta({ d, porId, editavel, gerir, modo, rodar, supabase }: Base & {
  porId: Record<string, Pessoa>; editavel: boolean; gerir: boolean; modo: "pauta" | "ata";
}) {
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const aberta = d.r.status === "agendada" || d.r.status === "em_andamento";
  const itens = modo === "ata" ? d.pauta.filter((p) => p.status !== "proposto" && p.status !== "recusado") : d.pauta;

  async function adicionar() {
    if (!titulo.trim()) return;
    const ok = editavel
      ? await rodar(() => supabase.from("reuniao_pauta").insert({
          reuniao_id: d.r.id, titulo: titulo.trim(), descricao: descricao.trim() || null, origem: "manual", status: "aceito",
          ordem: (d.pauta.reduce((m, p) => Math.max(m, p.ordem), 0) || 0) + 1,
        }))
      : await rodar(() => supabase.rpc("ritmo_sugerir_pauta", { p_reuniao: d.r.id, p_titulo: titulo, p_descricao: descricao || null }),
          "Sugestão enviada para quem conduz a reunião.");
    if (ok) { setTitulo(""); setDescricao(""); }
  }
  const setStatus = (p: ItemPauta, status: ItemPauta["status"], extra: Partial<ItemPauta> = {}) =>
    rodar(() => supabase.from("reuniao_pauta").update({ status, ...extra }).eq("id", p.id));

  const ORIGEM: Record<ItemPauta["origem"], string> = { manual: "", sugestao: "💡 sugestão", pendencia: "↩︎ veio da anterior" };
  const COR: Record<ItemPauta["status"], string> = {
    proposto: "bg-amber-100 text-amber-700", aceito: "bg-blue-100 text-blue-700", recusado: "bg-gray-200 text-gray-500 line-through",
    discutido: "bg-green-100 text-green-700", adiado: "bg-purple-100 text-purple-700",
  };

  return (
    <Secao titulo={modo === "ata" ? "3 · Pauta" : `📋 Pauta (${d.pauta.length})`}
      dica={modo === "ata" ? "Marque cada item como discutido ou adiado. Adiados voltam na próxima reunião (itens não marcados viram adiados ao fechar)."
        : "Obstáculos e assuntos que precisam de decisão. Problema de uma pessoa só não entra aqui — vira conversa individual."}>
      {itens.length === 0 && <p className="text-sm text-gray-400">Nenhum item na pauta.</p>}
      <ol className="space-y-2">
        {itens.map((p, i) => (
          <li key={p.id} className="flex flex-wrap items-start gap-2 rounded-lg border p-2 text-sm">
            <span className="w-5 text-right text-gray-400">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">{p.titulo}</p>
              {p.descricao && <p className="whitespace-pre-line text-xs text-gray-500">{p.descricao}</p>}
              <p className="text-[11px] text-gray-400">
                {ORIGEM[p.origem]}{p.sugerido_por && <> por {nomeCurto(porId[p.sugerido_por])}</>}
                {p.motivo_recusa && <> · recusado: “{p.motivo_recusa}”</>}
              </p>
            </div>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${COR[p.status]}`}>{p.status}</span>
            {editavel && (
              <div className="flex w-full flex-wrap justify-end gap-1 sm:w-auto">
                {p.status === "proposto" && <>
                  <button className="btn-ghost px-2 py-1 text-xs text-green-700" onClick={() => setStatus(p, "aceito")}>Aceitar</button>
                  <button className="btn-ghost px-2 py-1 text-xs text-gray-500" onClick={() => {
                    const m = prompt("Motivo da recusa (quem sugeriu verá):"); if (m !== null) setStatus(p, "recusado", { motivo_recusa: m.trim() || null });
                  }}>Recusar</button>
                </>}
                {modo === "ata" && (p.status === "aceito" || p.status === "discutido" || p.status === "adiado") && <>
                  <button className={`btn-ghost px-2 py-1 text-xs ${p.status === "discutido" ? "text-green-700 underline" : ""}`} onClick={() => setStatus(p, "discutido")}>Discutido</button>
                  <button className={`btn-ghost px-2 py-1 text-xs ${p.status === "adiado" ? "text-purple-700 underline" : ""}`} onClick={() => setStatus(p, "adiado")}>Adiar</button>
                </>}
                {modo === "pauta" && <button className="btn-ghost px-2 py-1 text-xs text-red-500" onClick={() => rodar(() => supabase.from("reuniao_pauta").delete().eq("id", p.id))}>Excluir</button>}
              </div>
            )}
          </li>
        ))}
      </ol>
      {aberta && (editavel || modo === "pauta") && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className="inp" placeholder={editavel ? "Novo item de pauta" : "Sugerir um assunto para a pauta"} value={titulo}
            onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && adicionar()} />
          <input className="inp" placeholder="Detalhe (opcional)" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={adicionar}>{editavel ? "Adicionar" : "Sugerir"}</button>
        </div>
      )}
      {!gerir && aberta && modo === "pauta" && <p className="mt-1 text-xs text-gray-400">Sua sugestão vai para quem conduz aceitar ou recusar.</p>}
    </Secao>
  );
}

// ---- decisões ------------------------------------------------------------------------------
function Decisoes({ d, editavel, rodar, supabase }: Base & { editavel: boolean }) {
  const [texto, setTexto] = useState("");
  async function add() {
    if (!texto.trim()) return;
    if (await rodar(() => supabase.from("reuniao_decisoes").insert({
      reuniao_id: d.r.id, texto: texto.trim(), ordem: (d.dec.reduce((m, x) => Math.max(m, x.ordem), 0) || 0) + 1,
    }))) setTexto("");
  }
  return (
    <Secao titulo={`4 · Decisões (${d.dec.length})`} dica="O que foi decidido — curto e claro. Ex.: “Trocar o fornecedor X por Y a partir de janeiro”.">
      {d.dec.length === 0 && <p className="text-sm text-gray-400">Nenhuma decisão registrada.</p>}
      <ol className="space-y-1">
        {d.dec.map((x, i) => (
          <li key={x.id} className="flex items-start gap-2 text-sm">
            <b className="text-gray-500">D{i + 1}.</b>
            <span className="flex-1 text-gray-800">{x.texto}</span>
            {editavel && <button className="text-xs text-gray-400 hover:text-red-500" onClick={() => rodar(() => supabase.from("reuniao_decisoes").delete().eq("id", x.id))}>excluir</button>}
          </li>
        ))}
      </ol>
      {editavel && (
        <div className="mt-3 flex gap-2">
          <input className="inp" placeholder="Nova decisão" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={add}>Adicionar</button>
        </div>
      )}
    </Secao>
  );
}

// ---- encaminhamentos ----------------------------------------------------------------------
function Encaminhamentos({ d, pessoas, porId, editavel, rodar, supabase, onAbrir }: Base & {
  pessoas: Pessoa[]; porId: Record<string, Pessoa>; editavel: boolean; onAbrir: (id: string) => void;
}) {
  const [form, setForm] = useState<Encaminhamento | "novo" | null>(null);
  return (
    <Secao titulo={`5 · Encaminhamentos (${d.enc.length})`}
      dica="Cada um com UM dono, prazo e evidência de conclusão. Ao fechar a ata vira tarefa; as partes viram subtarefas com seus responsáveis."
      acao={editavel && !form ? <button className="btn-primary text-xs" onClick={() => setForm("novo")}>+ Encaminhamento</button> : undefined}>
      {d.enc.length === 0 && !form && <p className="text-sm text-gray-400">Nenhum encaminhamento. Reunião que não gera encaminhamento talvez não precisasse existir.</p>}
      <div className="space-y-2">
        {d.enc.map((e, i) => form !== "novo" && form?.id === e.id ? (
          <FormEnc key={e.id} d={d} e={e} pessoas={pessoas} rodar={rodar} supabase={supabase} onFechar={() => setForm(null)} />
        ) : (
          <div key={e.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-start gap-2">
              <b className="text-gray-500">E{i + 1}.</b>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{e.o_que}</p>
                <p className="text-xs text-gray-600">
                  Dono: <b>{porId[e.dono_id]?.nome || porId[e.dono_id]?.email || "—"}</b> · Prazo: {dataLonga(e.prazo + "T12:00:00")}
                </p>
                <p className="text-xs text-gray-500">Evidência: {e.evidencia}</p>
                {e.partes?.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                    {e.partes.map((p, j) => (
                      <li key={j}>├─ {p.o_que} → {nomeCurto(p.responsavel_id ? porId[p.responsavel_id] : porId[e.dono_id])}{p.prazo ? ` · ${dataLonga(p.prazo + "T12:00:00")}` : ""}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {e.tarefa_id ? (
                  <>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_ENC[e.status ?? "aberto"].cls}`}>{STATUS_ENC[e.status ?? "aberto"].label}</span>
                    <button className="text-xs text-brand-700 hover:underline" onClick={() => onAbrir(e.tarefa_id!)}>abrir tarefa{(e.n_sub ?? 0) > 0 ? ` · ${e.n_sub_ok}/${e.n_sub}` : ""}</button>
                  </>
                ) : <span className="text-[11px] text-gray-400">vira tarefa ao fechar a ata</span>}
                {editavel && !e.tarefa_id && (
                  <span className="flex gap-2 text-xs">
                    <button className="text-brand-700 hover:underline" onClick={() => setForm(e)}>editar</button>
                    <button className="text-red-500 hover:underline" onClick={() => confirm("Excluir este encaminhamento?") && rodar(() => supabase.from("reuniao_encaminhamentos").delete().eq("id", e.id))}>excluir</button>
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {form === "novo" && <FormEnc d={d} pessoas={pessoas} rodar={rodar} supabase={supabase} onFechar={() => setForm(null)} />}
      </div>
    </Secao>
  );
}

function FormEnc({ d, e, pessoas, rodar, supabase, onFechar }: Base & {
  e?: Encaminhamento; pessoas: Pessoa[]; onFechar: () => void;
}) {
  const [oQue, setOQue] = useState(e?.o_que ?? "");
  const [dono, setDono] = useState(e?.dono_id ?? "");
  const [prazo, setPrazo] = useState(e?.prazo ?? "");
  const [evid, setEvid] = useState(e?.evidencia ?? "");
  const [decisao, setDecisao] = useState(e?.decisao_id ?? "");
  const [partes, setPartes] = useState<Parte[]>(e?.partes ?? []);
  const [falta, setFalta] = useState<string | null>(null);

  async function salvar() {
    const faltando = [!oQue.trim() && "o quê", !dono && "dono", !prazo && "prazo", !evid.trim() && "evidência"].filter(Boolean);
    if (faltando.length) { setFalta(`Preencha: ${faltando.join(", ")}. Sem dono, prazo e evidência o encaminhamento não acontece.`); return; }
    const campos = {
      o_que: oQue.trim(), dono_id: dono, prazo, evidencia: evid.trim(), decisao_id: decisao || null,
      partes: partes.filter((p) => p.o_que.trim()).map((p) => ({ o_que: p.o_que.trim(), responsavel_id: p.responsavel_id || null, prazo: p.prazo || null })),
    };
    const ok = e
      ? await rodar(() => supabase.from("reuniao_encaminhamentos").update(campos).eq("id", e.id))
      : await rodar(() => supabase.from("reuniao_encaminhamentos").insert({
          ...campos, reuniao_id: d.r.id, ordem: (d.enc.reduce((m, x) => Math.max(m, x.ordem), 0) || 0) + 1,
        }));
    if (ok) onFechar();
  }
  const mudarParte = (i: number, c: Partial<Parte>) => setPartes((l) => l.map((p, j) => (j === i ? { ...p, ...c } : p)));

  return (
    <div className="rounded-lg border-2 border-brand-200 bg-brand-50/30 p-3">
      {falta && <p className="mb-2 rounded bg-red-50 p-2 text-xs text-red-700">{falta}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="sm:col-span-3"><label className="lbl">O quê</label><input className="inp" autoFocus value={oQue} onChange={(x) => setOQue(x.target.value)} placeholder="Ex.: Negociar prazo de entrega com o fornecedor Y" /></div>
        <div>
          <label className="lbl">Dono (responde pelo todo)</label>
          <select className="inp" value={dono} onChange={(x) => setDono(x.target.value)}>
            <option value="">Escolha…</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
          </select>
        </div>
        <div><label className="lbl">Prazo</label><input type="date" className="inp" value={prazo} onChange={(x) => setPrazo(x.target.value)} /></div>
        <div>
          <label className="lbl">Ligado à decisão</label>
          <select className="inp" value={decisao} onChange={(x) => setDecisao(x.target.value)}>
            <option value="">—</option>
            {d.dec.map((x, i) => <option key={x.id} value={x.id}>D{i + 1}. {x.texto.slice(0, 40)}</option>)}
          </select>
        </div>
        <div className="sm:col-span-3"><label className="lbl">Evidência de conclusão — como saberemos que está feito?</label><input className="inp" value={evid} onChange={(x) => setEvid(x.target.value)} placeholder="Ex.: proposta assinada anexada na tarefa" /></div>
      </div>

      <div className="mt-3">
        <label className="lbl">Partes (viram subtarefas, cada uma com seu responsável)</label>
        <div className="space-y-2">
          {partes.map((p, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_12rem_10rem_auto]">
              <input className="inp" placeholder="Parte" value={p.o_que} onChange={(x) => mudarParte(i, { o_que: x.target.value })} />
              <select className="inp" value={p.responsavel_id ?? ""} onChange={(x) => mudarParte(i, { responsavel_id: x.target.value || null })}>
                <option value="">= dono</option>
                {pessoas.map((q) => <option key={q.id} value={q.id}>{q.nome || q.email}</option>)}
              </select>
              <input type="date" className="inp" value={p.prazo ?? ""} onChange={(x) => mudarParte(i, { prazo: x.target.value || null })} />
              <button className="btn-ghost text-sm text-gray-400" onClick={() => setPartes((l) => l.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
        <button className="mt-1 text-xs text-brand-700 hover:underline" onClick={() => setPartes((l) => [...l, { o_que: "", responsavel_id: null, prazo: null }])}>+ parte</button>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-ghost text-sm" onClick={onFechar}>Cancelar</button>
        <button className="btn-primary text-sm" onClick={salvar}>Salvar encaminhamento</button>
      </div>
    </div>
  );
}

// ---- acompanhamento -----------------------------------------------------------------------
function Acompanhamento({ d, porId, onAbrir }: { d: Dados; porId: Record<string, Pessoa>; onAbrir: (id: string) => void }) {
  const presentes = d.part.filter((p) => p.presenca === "presente");
  const cientes = presentes.filter((p) => p.ciencia_em).length;
  const feitos = d.enc.filter((e) => e.status === "feito_no_prazo" || e.status === "feito_atrasado").length;
  const ativos = d.enc.filter((e) => e.status !== "cancelado").length;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><p className="text-xs text-gray-500">Ciência da ata</p><p className="text-2xl font-bold text-gray-900">{cientes}/{presentes.length}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Encaminhamentos feitos</p><p className="text-2xl font-bold text-gray-900">{feitos}/{ativos}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Atrasados</p><p className={`text-2xl font-bold ${d.enc.some((e) => e.status === "atrasado") ? "text-red-600" : "text-gray-900"}`}>{d.enc.filter((e) => e.status === "atrasado").length}</p></div>
      </div>

      <Secao titulo="🎯 Encaminhamentos">
        {d.enc.length === 0 && <p className="text-sm text-gray-400">Nenhum encaminhamento.</p>}
        <div className="divide-y">
          {d.enc.map((e) => (
            <button key={e.id} onClick={() => e.tarefa_id && onAbrir(e.tarefa_id)} className="linha-lista flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-gray-50">
              <Avatar pessoa={porId[e.dono_id]} size={24} />
              <span className="linha-principal min-w-0 flex-1 truncate">{e.o_que}</span>
              {(e.n_sub ?? 0) > 0 && <span className="text-xs text-gray-500">{e.n_sub_ok}/{e.n_sub}</span>}
              <span className="w-24 text-xs text-gray-500">{rotuloPrazo(e.prazo_efetivo ?? e.prazo)}</span>
              <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_ENC[e.status ?? "aberto"].cls}`}>{STATUS_ENC[e.status ?? "aberto"].label}</span>
            </button>
          ))}
        </div>
      </Secao>

      <Secao titulo="✍️ Ciência dos presentes">
        {d.r.status !== "realizada" && <p className="mb-2 text-xs text-gray-400">A ciência é pedida quando a ata é fechada.</p>}
        <div className="divide-y">
          {d.part.map((p) => (
            <div key={p.perfil_id} className="flex items-center gap-3 py-2 text-sm">
              <Avatar pessoa={porId[p.perfil_id]} size={24} />
              <span className="flex-1">{porId[p.perfil_id]?.nome || porId[p.perfil_id]?.email || "Usuário"}</span>
              <span className="text-xs text-gray-500">
                {p.presenca === "ausente" ? "ausente" : p.presenca === "convidado" ? "—" : p.ciencia_em ? `✅ ${formatDateTime(p.ciencia_em)}` : "⏳ pendente"}
              </span>
            </div>
          ))}
        </div>
      </Secao>

      {d.r.reaberturas?.length > 0 && (
        <Secao titulo="↺ Reaberturas da ata">
          <ul className="space-y-1 text-sm">
            {d.r.reaberturas.map((x, i) => (
              <li key={i} className="text-gray-700">{formatDateTime(x.em)} · {porId[x.por]?.nome || "Usuário"} — “{x.motivo}”</li>
            ))}
          </ul>
        </Secao>
      )}
      {d.r.ata_fechada_em && <p className="text-xs text-gray-400">Ata fechada em {formatDateTime(d.r.ata_fechada_em)} por {porId[d.r.ata_fechada_por ?? ""]?.nome || "—"}.</p>}
    </>
  );
}
