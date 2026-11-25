"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { Avatar, useEquipe } from "@/components/tarefas/comum";
import TarefaDrawer from "@/components/tarefas/TarefaDrawer";
import NovaReuniao from "@/components/gestao/NovaReuniao";
import { rotuloPrazo } from "@/lib/tarefas";
import {
  STATUS_ENC, STATUS_REUNIAO, dataHoraCurta, dataLonga, tipoLabel,
  type Encaminhamento, type ItemPauta, type Reuniao,
} from "@/lib/ritmo";

// /gestao — o que é MEU no ritmo de gestão: próximas reuniões, meus
// encaminhamentos e atas esperando a minha ciência. Quem conduz vê também
// as sugestões de pauta pendentes.
export default function GestaoHub() {
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const { userId } = acesso;
  const { porId } = useEquipe();
  const [proximas, setProximas] = useState<Reuniao[]>([]);
  const [meusEnc, setMeusEnc] = useState<Encaminhamento[]>([]);
  const [ciencia, setCiencia] = useState<Reuniao[]>([]);
  const [sugestoes, setSugestoes] = useState<(ItemPauta & { reunioes: { titulo: string; data_hora: string } | null })[]>([]);
  const [nova, setNova] = useState(false);
  const [tarefa, setTarefa] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(async () => {
    if (!userId) return;
    const ontem = new Date(Date.now() - 86400000).toISOString();
    const [r, e, c, s] = await Promise.all([
      supabase.from("reunioes").select("*").in("status", ["agendada", "em_andamento"]).gte("data_hora", ontem)
        .order("data_hora").limit(20),
      supabase.from("vw_encaminhamentos").select("*").eq("dono_id", userId).in("status", ["aberto", "atrasado"])
        .order("prazo_efetivo").limit(50),
      supabase.from("reuniao_participantes").select("reunioes!inner(*)").eq("perfil_id", userId)
        .eq("presenca", "presente").is("ciencia_em", null).eq("reunioes.status", "realizada").limit(20),
      acesso.conduz
        ? supabase.from("reuniao_pauta").select("*, reunioes(titulo, data_hora)").eq("status", "proposto").order("criado_em").limit(20)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setProximas((r.data ?? []) as Reuniao[]);
    setMeusEnc((e.data ?? []) as Encaminhamento[]);
    setCiencia(((c.data ?? []) as any[]).map((x) => x.reunioes as Reuniao));
    setSugestoes((s.data ?? []) as any);
    setCarregado(true);
  }, [supabase, userId, acesso.conduz]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">🧭 Ritmo de Gestão</h1>
          <p className="text-sm text-gray-500">Reunião → decisão → encaminhamento com dono e prazo → a próxima reunião cobra.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/gestao/reunioes" className="btn-ghost text-sm ring-1 ring-gray-200">📚 Todas as reuniões</Link>
          {acesso.conduz && <button className="btn-primary text-sm" onClick={() => setNova(true)}>+ Nova reunião</button>}
        </div>
      </div>

      {!acesso.conduz && acesso.gerencia && (
        <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
          Para criar e conduzir reuniões, peça a quem administra para marcar “Conduz reuniões” no seu usuário em <b>Usuários e acessos</b>.
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="font-semibold text-gray-800">📅 Próximas reuniões</h2>
          {carregado && proximas.length === 0 && <p className="mt-3 text-sm text-gray-400">Nenhuma reunião agendada.</p>}
          <div className="mt-2 divide-y">
            {proximas.map((r) => (
              <Link key={r.id} href={`/gestao/reunioes/${r.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">
                    {r.confidencial && <span title="Confidencial">🔒 </span>}{r.titulo}
                  </p>
                  <p className="text-xs text-gray-500">{dataHoraCurta(r.data_hora)}{r.local ? ` · ${r.local}` : ""}</p>
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_REUNIAO[r.status].cls}`}>{STATUS_REUNIAO[r.status].label}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="card p-4">
          <h2 className="font-semibold text-gray-800">🎯 Meus encaminhamentos</h2>
          {carregado && meusEnc.length === 0 && <p className="mt-3 text-sm text-gray-400">Nada pendente com você. 👏</p>}
          <div className="mt-2 divide-y">
            {meusEnc.map((e) => (
              <button key={e.id} onClick={() => e.tarefa_id && setTarefa(e.tarefa_id)}
                className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-gray-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">{e.o_que}</p>
                  <p className="truncate text-xs text-gray-500">
                    {e.reuniao_confidencial ? "🔒 " : ""}{e.reuniao_titulo} · {e.reuniao_data ? dataLonga(e.reuniao_data) : ""}
                    {(e.n_sub ?? 0) > 0 && <> · {e.n_sub_ok}/{e.n_sub} partes</>}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_ENC[e.status ?? "aberto"].cls}`}>{STATUS_ENC[e.status ?? "aberto"].label}</span>
                  <p className="mt-0.5 text-[11px] text-gray-500">{rotuloPrazo(e.prazo_efetivo ?? e.prazo)}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {ciencia.length > 0 && (
          <section className="card p-4">
            <h2 className="font-semibold text-gray-800">✍️ Atas aguardando sua ciência</h2>
            <div className="mt-2 divide-y">
              {ciencia.map((r) => (
                <Link key={r.id} href={`/gestao/reunioes/${r.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{r.confidencial ? "🔒 " : ""}{r.titulo}</p>
                    <p className="text-xs text-gray-500">{tipoLabel(r.tipo)} · {dataLonga(r.data_hora)}</p>
                  </div>
                  <span className="text-xs text-brand-700">Ler e confirmar →</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {acesso.conduz && sugestoes.length > 0 && (
          <section className="card p-4">
            <h2 className="font-semibold text-gray-800">💡 Sugestões de pauta para responder</h2>
            <div className="mt-2 divide-y">
              {sugestoes.map((s) => (
                <Link key={s.id} href={`/gestao/reunioes/${s.reuniao_id}`} className="flex items-center gap-3 py-2.5 text-sm hover:bg-gray-50">
                  <Avatar pessoa={s.sugerido_por ? porId[s.sugerido_por] : null} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900">{s.titulo}</p>
                    <p className="truncate text-xs text-gray-500">{s.reunioes?.titulo} · {s.reunioes ? dataHoraCurta(s.reunioes.data_hora) : ""}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {nova && <NovaReuniao onClose={() => setNova(false)} />}
      {tarefa && <TarefaDrawer tarefaId={tarefa} onClose={() => setTarefa(null)} onChange={carregar} />}
    </div>
  );
}
