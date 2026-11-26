"use client";

import { useState } from "react";
import { papelLabel } from "@/lib/permissoes";

type Pessoa = { id: string; nome: string; email: string | null; papel: string | null; dono: boolean };

export default function AcessosLancamento({ pessoas, marcados, euId }: { pessoas: Pessoa[]; marcados: string[]; euId: string }) {
  const [sel, setSel] = useState<Set<string>>(new Set(marcados));
  const [salvo, setSalvo] = useState<Set<string>>(new Set(marcados));
  const [gravando, setGravando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const mudou = sel.size !== salvo.size || [...sel].some((e) => !salvo.has(e));
  const alternar = (email: string) =>
    setSel((s) => { const n = new Set(s); n.has(email) ? n.delete(email) : n.add(email); return n; });

  async function salvar() {
    setGravando(true); setMsg(null);
    try {
      const r = await fetch("/api/agente/acessos", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails: [...sel] }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "Falha ao salvar.");
      const ok = new Set<string>(d.emails ?? []);
      setSel(ok); setSalvo(ok); setMsg("Salvo. Vale a partir da próxima mensagem no chat.");
    } catch (e: any) {
      setMsg("⚠️ " + (e?.message ?? String(e)));
    } finally {
      setGravando(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="divide-y rounded-xl border bg-white">
        {pessoas.map((p) => {
          const email = (p.email ?? "").toLowerCase();
          const sempre = p.dono; // dono já lança (e faz tudo)
          return (
            <label key={p.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${!email || sempre ? "opacity-70" : "cursor-pointer hover:bg-gray-50"}`}>
              <input type="checkbox" disabled={!email || sempre || gravando} checked={sempre || (!!email && sel.has(email))}
                onChange={() => email && alternar(email)} />
              <span className="flex-1">
                {p.nome}{p.id === euId ? " (você)" : ""}
                <span className="block text-xs text-gray-500">{p.email ?? "sem e-mail"} · {papelLabel(p.papel)}</span>
              </span>
              {sempre && <span className="text-xs text-gray-500">dono — já lança</span>}
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={salvar} disabled={!mudou || gravando} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          {gravando ? "Salvando…" : "Salvar"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}
