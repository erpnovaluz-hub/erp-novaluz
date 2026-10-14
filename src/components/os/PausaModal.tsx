"use client";

import { useState } from "react";
import { MOTIVOS_PAUSA } from "@/lib/os";

// Pausar a OS exige motivo (o banco também barra sem motivo).
export default function PausaModal({ titulo, onConfirmar, onCancelar }: {
  titulo: string; onConfirmar: (motivo: string, obs: string) => void; onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState("material");
  const [obs, setObs] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onCancelar}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <p className="font-semibold text-gray-900">⏸️ Pausar OS</p>
        <p className="mb-3 truncate text-sm text-gray-500">{titulo}</p>
        <div className="space-y-2">
          {MOTIVOS_PAUSA.map((m) => (
            <label key={m.value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${motivo === m.value ? "border-amber-400 bg-amber-50" : "border-gray-200"}`}>
              <input type="radio" name="motivo" checked={motivo === m.value} onChange={() => setMotivo(m.value)} /> {m.label}
            </label>
          ))}
        </div>
        <textarea className="inp mt-3" rows={2} placeholder="Detalhe (ex.: aguardando chapa 6,3mm do fornecedor X)" value={obs} onChange={(e) => setObs(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancelar}>Cancelar</button>
          <button className="btn-primary" onClick={() => onConfirmar(motivo, obs.trim())}>Pausar</button>
        </div>
      </div>
    </div>
  );
}
