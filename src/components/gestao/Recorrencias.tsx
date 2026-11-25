"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { useEquipe } from "@/components/tarefas/comum";
import {
  DIAS_SEMANA, FREQUENCIAS, SEMANAS_MES, TIPOS, dataLonga, descreverRecorrencia,
  type Frequencia, type Recorrencia, type TipoReuniao,
} from "@/lib/ritmo";

type Prevista = { recorrencia_id: string; data_prevista: string | null; criada: boolean };

// Card "Reuniões recorrentes" (Bloco 4): moldes que o pg_cron usa para criar a
// próxima reunião da série. Gerência vê; quem conduz cria/edita.
export default function Recorrencias() {
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const { porId } = useEquipe();
  const [lista, setLista] = useState<Recorrencia[]>([]);
  const [prev, setPrev] = useState<Record<string, Prevista>>({});
  const [form, setForm] = useState<Recorrencia | "nova" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [r, p] = await Promise.all([
      supabase.from("reuniao_recorrencias").select("*").order("criado_em"),
      supabase.rpc("ritmo_previstas"),
    ]);
    setLista((r.data ?? []) as Recorrencia[]);
    setPrev(Object.fromEntries(((p.data ?? []) as Prevista[]).map((x) => [x.recorrencia_id, x])));
  }, [supabase]);

  useEffect(() => { if (acesso.gerencia) carregar(); }, [carregar, acesso.gerencia]);

  if (!acesso.gerencia) return null;

  return (
    <section id="recorrentes" className="card mt-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-800">🔁 Reuniões recorrentes</h2>
          <p className="text-xs text-gray-400">O sistema cria a próxima reunião sozinho (07:00), com convites, pendências da anterior e indicadores fora da faixa na pauta.</p>
        </div>
        {acesso.conduz && !form && <button className="btn-primary text-xs" onClick={() => setForm("nova")}>+ Nova recorrência</button>}
      </div>
      {erro && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">{erro}</p>}

      {lista.length === 0 && !form && <p className="mt-2 text-sm text-gray-400">Nenhuma ainda. Comece pela semanal de operação.</p>}
      <div className="mt-2 divide-y">
        {lista.map((r) => form !== "nova" && form?.id === r.id ? (
          <FormRec key={r.id} r={r} onFechar={() => setForm(null)} onSalvo={carregar} setErro={setErro} />
        ) : (
          <div key={r.id} className={`flex flex-wrap items-center gap-2 py-2 text-sm ${r.ativo ? "" : "text-gray-400"}`}>
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${r.ativo ? "text-gray-900" : ""}`}>{r.titulo}</p>
              <p className="text-xs text-gray-500">
                {descreverRecorrencia(r)} · {r.participantes.length + 1} pessoa(s) · conduz {porId[r.conduzida_por ?? ""]?.nome ?? "—"}
              </p>
            </div>
            <span className="text-xs text-gray-500">
              {!r.ativo ? "pausada" : prev[r.id]?.data_prevista
                ? `próxima: ${dataLonga(prev[r.id].data_prevista + "T12:00:00")}${prev[r.id].criada ? " ✓ criada" : ` · criada ${r.antecedencia_dias} dias antes`}`
                : ""}
            </span>
            {acesso.conduz && <button className="text-xs text-brand-700 hover:underline" onClick={() => setForm(r)}>editar</button>}
          </div>
        ))}
        {form === "nova" && <FormRec onFechar={() => setForm(null)} onSalvo={carregar} setErro={setErro} />}
      </div>
    </section>
  );
}

function FormRec({ r, onFechar, onSalvo, setErro }: {
  r?: Recorrencia; onFechar: () => void; onSalvo: () => void; setErro: (e: string | null) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { userId } = useAcesso();
  const { pessoas } = useEquipe();
  const [titulo, setTitulo] = useState(r?.titulo ?? "Semanal de operação");
  const [tipo, setTipo] = useState<TipoReuniao>(r?.tipo ?? "semanal");
  const [freq, setFreq] = useState<Frequencia>(r?.frequencia ?? "semanal");
  const [dia, setDia] = useState(r?.dia_semana ?? 4);
  const [semana, setSemana] = useState(r?.semana_do_mes ?? 1);
  const [hora, setHora] = useState((r?.hora ?? "08:00").slice(0, 5));
  const [duracao, setDuracao] = useState(r?.duracao_min ?? 60);
  const [local, setLocal] = useState(r?.local ?? "");
  const [conduz, setConduz] = useState(r?.conduzida_por ?? userId ?? "");
  const [part, setPart] = useState<Set<string>>(new Set(r?.participantes ?? []));
  const [antec, setAntec] = useState(r?.antecedencia_dias ?? 6);
  const [ativo, setAtivo] = useState(r?.ativo ?? true);
  const mensal = freq === "mensal" || freq === "trimestral";

  function mudarFreq(f: Frequencia) {
    setFreq(f);
    setAntec(FREQUENCIAS.find((x) => x.key === f)!.antecedencia);
    if (!r) setTipo(f === "mensal" ? "mensal" : f === "trimestral" ? "trimestral" : "semanal");
  }

  async function salvar() {
    setErro(null);
    if (!titulo.trim()) { setErro("Dê um título."); return; }
    const campos = {
      titulo: titulo.trim(), tipo, frequencia: freq, dia_semana: dia, semana_do_mes: mensal ? semana : null,
      hora, duracao_min: duracao, local: local.trim() || null, conduzida_por: conduz || null,
      participantes: [...part].filter((x) => x !== conduz), antecedencia_dias: antec, ativo,
    };
    const { error } = r
      ? await supabase.from("reuniao_recorrencias").update(campos).eq("id", r.id)
      : await supabase.from("reuniao_recorrencias").insert(campos);
    if (error) { setErro(error.message); return; }
    onSalvo(); onFechar();
  }

  async function excluir() {
    if (!r || !confirm(`Excluir a recorrência "${r.titulo}"? As reuniões já criadas continuam. Para só pausar, desmarque "ativa".`)) return;
    const { error } = await supabase.from("reuniao_recorrencias").delete().eq("id", r.id);
    if (error) { setErro(error.message); return; }
    onSalvo(); onFechar();
  }

  return (
    <div className="my-2 rounded-lg border-2 border-brand-200 bg-brand-50/30 p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="sm:col-span-2"><label className="lbl">Título</label><input className="inp" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
        <div>
          <label className="lbl">Tipo</label>
          <select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value as TipoReuniao)}>
            {TIPOS.filter((t) => t.key !== "extraordinaria").map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="lbl">Frequência</label>
          <select className="inp" value={freq} onChange={(e) => mudarFreq(e.target.value as Frequencia)}>
            {FREQUENCIAS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        {mensal && (
          <div>
            <label className="lbl">Semana do mês</label>
            <select className="inp" value={semana} onChange={(e) => setSemana(Number(e.target.value))}>
              {SEMANAS_MES.map((s, i) => <option key={s} value={i + 1}>{s}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="lbl">Dia</label>
          <select className="inp" value={dia} onChange={(e) => setDia(Number(e.target.value))}>
            {DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </div>
        <div><label className="lbl">Hora</label><input type="time" className="inp" value={hora} onChange={(e) => setHora(e.target.value)} /></div>
        <div><label className="lbl">Duração (min)</label><input type="number" className="inp" value={duracao} onChange={(e) => setDuracao(Number(e.target.value) || 60)} /></div>
        <div><label className="lbl">Local</label><input className="inp" value={local} onChange={(e) => setLocal(e.target.value)} /></div>
        <div>
          <label className="lbl">Quem conduz</label>
          <select className="inp" value={conduz} onChange={(e) => setConduz(e.target.value)}>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
          </select>
        </div>
        <div><label className="lbl">Criar com antecedência (dias)</label><input type="number" min={1} max={60} className="inp" value={antec} onChange={(e) => setAntec(Number(e.target.value) || 6)} /></div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> ativa</label>
      </div>
      <div className="mt-3">
        <label className="lbl">Participantes ({part.size})</label>
        <div className="flex flex-wrap gap-1">
          {pessoas.filter((p) => p.id !== conduz).map((p) => (
            <button key={p.id} type="button" onClick={() => setPart((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
              className={`rounded-full px-2.5 py-1 text-xs ring-1 ${part.has(p.id) ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-gray-700 ring-gray-200"}`}>
              {p.nome || p.email}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-400">Quem conduz entra sempre. Os participantes recebem o convite quando cada reunião é criada.</p>
      </div>
      <div className="mt-3 flex justify-between gap-2">
        {r ? <button className="btn-ghost text-sm text-red-500" onClick={excluir}>Excluir</button> : <span />}
        <div className="flex gap-2">
          <button className="btn-ghost text-sm" onClick={onFechar}>Cancelar</button>
          <button className="btn-primary text-sm" onClick={salvar}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
