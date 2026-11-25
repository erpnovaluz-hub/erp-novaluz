"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { useEquipe } from "@/components/tarefas/comum";
import { TIPOS, dataLonga, paraInputDataHora, type Reuniao, type TipoReuniao } from "@/lib/ritmo";

// Modal "Nova reunião" — chama a RPC ritmo_criar_reuniao (0070), que também
// inclui quem cria/conduz e traz para a pauta os itens adiados da anterior.
export default function NovaReuniao({ onClose }: { onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { userId } = useAcesso();
  const { pessoas } = useEquipe();

  const amanha8 = new Date(); amanha8.setDate(amanha8.getDate() + 1); amanha8.setHours(8, 0, 0, 0);
  const [tipo, setTipo] = useState<TipoReuniao>("semanal");
  const [titulo, setTitulo] = useState(TIPOS[0].label);
  const [tituloMexido, setTituloMexido] = useState(false);
  const [quando, setQuando] = useState(paraInputDataHora(amanha8));
  const [duracao, setDuracao] = useState(60);
  const [local, setLocal] = useState("");
  const [confidencial, setConfidencial] = useState(false);
  const [conduz, setConduz] = useState(userId ?? "");
  const [anterior, setAnterior] = useState<string>("");          // "" = automático
  const [anteriores, setAnteriores] = useState<Reuniao[]>([]);
  const [part, setPart] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const t = TIPOS.find((x) => x.key === tipo)!;
    setDuracao(t.duracao);
    if (!tituloMexido) setTitulo(t.label);
    supabase.from("reunioes").select("*").eq("tipo", tipo).eq("status", "realizada")
      .order("data_hora", { ascending: false }).limit(10)
      .then(({ data }) => setAnteriores((data ?? []) as Reuniao[]));
  }, [supabase, tipo, tituloMexido]);

  useEffect(() => { if (!conduz && userId) setConduz(userId); }, [userId, conduz]);

  function alternar(id: string) {
    setPart((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function criar() {
    setErro(null);
    if (!titulo.trim()) { setErro("Dê um título à reunião."); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc("ritmo_criar_reuniao", {
      p_titulo: titulo.trim(), p_tipo: tipo, p_data_hora: new Date(quando).toISOString(), p_duracao: duracao,
      p_local: local, p_confidencial: confidencial, p_conduzida_por: conduz || null,
      p_anterior: anterior || null, p_participantes: [...part], p_observacoes: null,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    router.push(`/gestao/reunioes/${data}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Nova reunião</h2>
          <button className="btn-ghost text-lg leading-none" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        {erro && <div className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</div>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="lbl">Tipo</label>
            <select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value as TipoReuniao)}>
              {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label} — {t.pergunta}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="lbl">Título</label>
            <input className="inp" value={titulo} onChange={(e) => { setTitulo(e.target.value); setTituloMexido(true); }} />
          </div>
          <div>
            <label className="lbl">Data e hora</label>
            <input type="datetime-local" className="inp" value={quando} onChange={(e) => setQuando(e.target.value)} />
          </div>
          <div>
            <label className="lbl">Duração (min)</label>
            <input type="number" min={5} step={5} className="inp" value={duracao} onChange={(e) => setDuracao(Number(e.target.value) || 60)} />
          </div>
          <div>
            <label className="lbl">Local</label>
            <input className="inp" placeholder="Sala, obra, online…" value={local} onChange={(e) => setLocal(e.target.value)} />
          </div>
          <div>
            <label className="lbl">Quem conduz</label>
            <select className="inp" value={conduz} onChange={(e) => setConduz(e.target.value)}>
              <option value={userId ?? ""}>Eu</option>
              {pessoas.filter((p) => p.id !== userId).map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="lbl">Reunião anterior da série (pendências vêm dela)</label>
            <select className="inp" value={anterior} onChange={(e) => setAnterior(e.target.value)}>
              <option value="">{confidencial ? "Nenhuma" : "Automático — a última deste tipo"}</option>
              {anteriores.map((r) => <option key={r.id} value={r.id}>{r.titulo} · {dataLonga(r.data_hora)}{r.confidencial ? " · confidencial" : ""}</option>)}
            </select>
          </div>
          <label className="flex items-start gap-2 rounded-lg bg-purple-50 p-3 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={confidencial} onChange={(e) => setConfidencial(e.target.checked)} />
            <span>
              <b className="text-purple-800">Confidencial</b>
              <span className="block text-xs text-purple-700">Só os participantes veem a ata e as tarefas que nascerem dela — nem a gerência de fora da lista.</span>
            </span>
          </label>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="lbl mb-0">Participantes ({part.size})</label>
            <button className="text-xs text-brand-700 hover:underline"
              onClick={() => setPart(part.size === pessoas.length ? new Set() : new Set(pessoas.map((p) => p.id)))}>
              {part.size === pessoas.length ? "Limpar" : "Marcar todos"}
            </button>
          </div>
          <div className="mt-1 max-h-48 divide-y overflow-y-auto rounded-lg border">
            {pessoas.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
                <input type="checkbox" checked={part.has(p.id) || p.id === userId || p.id === conduz}
                  disabled={p.id === userId || p.id === conduz} onChange={() => alternar(p.id)} />
                <span className="min-w-0 flex-1 truncate">{p.nome || p.email}</span>
                <span className="truncate text-xs text-gray-400">{p.email}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">Quem cria e quem conduz entram automaticamente. Cada participante recebe o convite.</p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={salvando} onClick={criar}>{salvando ? "Criando…" : "Criar reunião"}</button>
        </div>
      </div>
    </div>
  );
}
