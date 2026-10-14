"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso, usePode } from "@/components/AcessoProvider";
import { formatDateTime } from "@/lib/format";
import { STATUS_OS, motivoPausaLabel, statusOSLabel } from "@/lib/os";
import { Avatar, useEquipe } from "@/components/tarefas/comum";
import PausaModal from "@/components/os/PausaModal";

type Hist = { id: string; de: string | null; para: string; motivo: string | null; obs: string | null; usuario_id: string | null; data: string };

// Status (com pausa e motivo), responsável, acompanhantes e histórico da OS.
export default function OSControle({ os, onChange }: { os: Record<string, any>; onChange: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { userId } = useAcesso();
  const podeEditar = usePode("os", "editar");
  const { pessoas, porId } = useEquipe();
  const [acomp, setAcomp] = useState<string[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [verHist, setVerHist] = useState(false);
  const [pausar, setPausar] = useState(false);
  const [add, setAdd] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [a, h] = await Promise.all([
      supabase.from("os_acompanhantes").select("perfil_id").eq("os_id", os.id),
      supabase.from("os_historico").select("*").eq("os_id", os.id).order("data", { ascending: false }).limit(100),
    ]);
    setAcomp(((a.data ?? []) as any[]).map((x) => x.perfil_id));
    setHist((h.data ?? []) as Hist[]);
  }, [supabase, os.id]);
  useEffect(() => { carregar(); }, [carregar, os.status, os.responsavel_id]);

  async function salvar(campos: Record<string, any>) {
    setErro(null);
    const { error } = await supabase.from("ordens_servico").update(campos).eq("id", os.id);
    if (error) { setErro(error.message); return; }
    onChange();
  }

  function trocarStatus(s: string) {
    if (s === os.status) return;
    if (s === "pausada") { setPausar(true); return; }
    if (s === "cancelado" && !confirm("Cancelar esta OS?")) return;
    salvar({ status: s });
  }

  async function incluir(id: string) {
    setAdd(false);
    if (!id) return;
    const { error } = await supabase.from("os_acompanhantes").insert({ os_id: os.id, perfil_id: id });
    if (error) setErro(error.message);
    carregar();
  }
  async function remover(id: string) {
    const { error } = await supabase.from("os_acompanhantes").delete().match({ os_id: os.id, perfil_id: id });
    if (error) setErro(error.message);
    carregar();
  }

  const disponiveis = pessoas.filter((p) => !acomp.includes(p.id) && p.id !== os.responsavel_id);
  const nome = (id: string | null) => (id ? porId[id]?.nome || porId[id]?.email || "—" : "—");

  return (
    <div className="card space-y-4 p-4 text-sm">
      {os.status === "pausada" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          ⏸️ <b>Pausada</b> — {motivoPausaLabel(os.motivo_pausa)}{os.pausa_obs ? `: ${os.pausa_obs}` : ""}
          <span className="ml-1 text-xs text-amber-700">(desde {formatDateTime(os.status_desde)})</span>
          {podeEditar && <button className="ml-3 font-medium text-amber-900 underline" onClick={() => salvar({ status: "em_andamento" })}>▶ Retomar</button>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="lbl">Status</span>
          <select className="inp" value={os.status} disabled={!podeEditar} onChange={(e) => trocarStatus(e.target.value)}>
            {STATUS_OS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="lbl">Responsável</span>
          <div className="flex items-center gap-2">
            <Avatar pessoa={os.responsavel_id ? porId[os.responsavel_id] : null} />
            <select className="inp" value={os.responsavel_id ?? ""} disabled={!podeEditar} onChange={(e) => salvar({ responsavel_id: e.target.value || null })}>
              <option value="">{os.responsavel ? `— (antigo: ${os.responsavel})` : "Sem responsável"}</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
            </select>
          </div>
        </label>
        <div>
          <span className="lbl">Acompanhantes</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {acomp.map((id) => (
              <span key={id} className="group inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-0.5 pr-2 text-xs text-gray-700">
                <Avatar pessoa={porId[id] ?? null} size={20} />{nome(id).split(" ")[0]}
                {(podeEditar || id === userId) && <button className="text-gray-400 opacity-0 hover:text-red-500 group-hover:opacity-100" onClick={() => remover(id)} aria-label="Remover">×</button>}
              </span>
            ))}
            {podeEditar && (add ? (
              <select autoFocus className="inp w-auto py-1 text-xs" defaultValue="" onBlur={() => setAdd(false)} onChange={(e) => incluir(e.target.value)}>
                <option value="">— pessoa —</option>
                {disponiveis.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
              </select>
            ) : disponiveis.length > 0 && (
              <button className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:text-brand-700" onClick={() => setAdd(true)}>+ adicionar</button>
            ))}
          </div>
        </div>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <div>
        <button className="text-xs text-brand-600 hover:underline" onClick={() => setVerHist((v) => !v)}>
          {verHist ? "▾" : "▸"} Histórico de status ({hist.length})
        </button>
        {verHist && (
          <ol className="mt-2 space-y-1.5 border-l-2 border-gray-100 pl-3">
            {hist.map((h) => (
              <li key={h.id} className="text-xs text-gray-600">
                <b className="text-gray-800">{statusOSLabel(h.para)}</b>
                {h.de && <> (antes: {statusOSLabel(h.de)})</>}
                {h.motivo && <> · {motivoPausaLabel(h.motivo)}</>}{h.obs && <> · {h.obs}</>}
                <span className="text-gray-400"> — {formatDateTime(h.data)}{h.usuario_id ? ` · ${nome(h.usuario_id)}` : ""}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {pausar && (
        <PausaModal titulo={`${os.numero ?? ""} ${os.titulo}`} onCancelar={() => setPausar(false)}
          onConfirmar={(m, o) => { setPausar(false); salvar({ status: "pausada", motivo_pausa: m, pausa_obs: o || null }); }} />
      )}
    </div>
  );
}
