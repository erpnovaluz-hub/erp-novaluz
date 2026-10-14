"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { numeroBR } from "@/lib/planilha";

type Opcao = { id: string; nome: string };
export const TIPOS_HORA = [
  { value: "normal", label: "Normal" },
  { value: "extra50", label: "Extra 50%" },
  { value: "extra100", label: "Extra 100%" },
];
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Apontar horas: uma ou várias pessoas da equipe de uma vez (mesmas horas).
// Se escolher uma atividade, dá para atualizar o % de conclusão dela junto.
export default function ApontarForm({ osId, atividades, onSalvo }: {
  osId: string; atividades: { id: string; descricao: string; conclusao_pct?: number | null }[]; onSalvo: (n: number) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [equipe, setEquipe] = useState<Opcao[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [data, setData] = useState(hojeISO());
  const [horas, setHoras] = useState("8");
  const [tipo, setTipo] = useState("normal");
  const [atividade, setAtividade] = useState("");
  const [pct, setPct] = useState("");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    supabase.from("vw_equipe").select("id, nome").eq("ativo", true).order("nome").range(0, 4999).then(({ data: d }) => setEquipe(d ?? []));
  }, [supabase]);
  useEffect(() => {
    const a = atividades.find((x) => x.id === atividade);
    setPct(a?.conclusao_pct != null ? String(a.conclusao_pct) : "");
  }, [atividade, atividades]);

  const h = numeroBR(horas);
  const ok = sel.length > 0 && h != null && !Number.isNaN(h) && h > 0 && h <= 24 && !!data;

  async function salvar() {
    if (!ok) return;
    setGravando(true); setErro(null);
    const { error } = await supabase.from("os_apontamentos").insert(sel.map((colaborador_id) => ({
      os_id: osId, colaborador_id, data, horas: h, tipo, atividade_id: atividade || null, observacao: obs.trim() || null,
    })));
    if (!error && atividade && pct.trim() !== "") {
      const p = Math.max(0, Math.min(100, Number(pct) || 0));
      await supabase.from("atividades_os").update({ conclusao_pct: p, status: p >= 100 ? "concluido" : "em_andamento" }).eq("id", atividade);
    }
    setGravando(false);
    if (error) { setErro(error.message); return; }
    const n = sel.length;
    setSel([]); setObs("");
    onSalvo(n);
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="lbl">Quem trabalhou * <span className="font-normal text-gray-400">(toque em várias pessoas para apontar a equipe)</span></span>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {equipe.map((e) => {
            const on = sel.includes(e.id);
            return (
              <button key={e.id} type="button" onClick={() => setSel((l) => (on ? l.filter((x) => x !== e.id) : [...l, e.id]))}
                className={`rounded-full border px-3 py-1.5 ${on ? "border-brand-600 bg-brand-600 text-white" : "border-gray-200 bg-white text-gray-700"}`}>
                {e.nome}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block"><span className="lbl">Dia</span><input type="date" className="inp" value={data} onChange={(e) => setData(e.target.value)} /></label>
        <label className="block"><span className="lbl">Horas</span><input inputMode="decimal" className="inp" value={horas} onChange={(e) => setHoras(e.target.value)} /></label>
        <label className="block"><span className="lbl">Tipo</span>
          <select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_HORA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
      </div>
      {atividades.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 block"><span className="lbl">Atividade (opcional)</span>
            <select className="inp" value={atividade} onChange={(e) => setAtividade(e.target.value)}>
              <option value="">—</option>
              {atividades.map((a) => <option key={a.id} value={a.id}>{a.descricao}</option>)}
            </select>
          </label>
          {atividade && (
            <label className="block"><span className="lbl">% concluída</span>
              <input type="number" min={0} max={100} className="inp" value={pct} onChange={(e) => setPct(e.target.value)} />
            </label>
          )}
        </div>
      )}
      <input className="inp" placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
      {erro && <p className="text-red-600">{erro}</p>}
      <button className="btn-primary w-full py-2.5" disabled={!ok || gravando} onClick={salvar}>
        {gravando ? "Salvando…" : `⏱️ Apontar ${h && !Number.isNaN(h) ? String(h).replace(".", ",") : "?"} h${sel.length > 1 ? ` para ${sel.length} pessoas` : ""}`}
      </button>
    </div>
  );
}
