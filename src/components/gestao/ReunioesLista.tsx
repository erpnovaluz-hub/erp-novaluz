"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import NovaReuniao from "@/components/gestao/NovaReuniao";
import { STATUS_REUNIAO, TIPOS, dataHoraCurta, tipoLabel, type Reuniao, type StatusReuniao, type TipoReuniao } from "@/lib/ritmo";

// /gestao/reunioes — histórico. O RLS já filtra: gerência vê as normais,
// confidenciais só quem participa.
export default function ReunioesLista() {
  const supabase = useMemo(() => createClient(), []);
  const acesso = useAcesso();
  const [lista, setLista] = useState<Reuniao[]>([]);
  const [tipo, setTipo] = useState<TipoReuniao | "">("");
  const [status, setStatus] = useState<StatusReuniao | "">("");
  const [nova, setNova] = useState(false);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    let q = supabase.from("reunioes").select("*").order("data_hora", { ascending: false }).limit(200);
    if (tipo) q = q.eq("tipo", tipo);
    if (status) q = q.eq("status", status);
    q.then(({ data }) => { setLista((data ?? []) as Reuniao[]); setCarregado(true); });
  }, [supabase, tipo, status]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/gestao" className="text-xs text-brand-700 hover:underline">← Ritmo de Gestão</Link>
          <h1 className="text-xl font-bold text-gray-900">📚 Reuniões</h1>
        </div>
        {acesso.conduz && <button className="btn-primary text-sm" onClick={() => setNova(true)}>+ Nova reunião</button>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <select className="inp w-auto" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
          <option value="">Todos os tipos</option>
          {TIPOS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select className="inp w-auto" value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="">Todas as situações</option>
          {(Object.keys(STATUS_REUNIAO) as StatusReuniao[]).map((s) => <option key={s} value={s}>{STATUS_REUNIAO[s].label}</option>)}
        </select>
      </div>

      <div className="card mt-3 divide-y overflow-hidden">
        {carregado && lista.length === 0 && <p className="p-8 text-center text-sm text-gray-400">Nenhuma reunião encontrada.</p>}
        {lista.map((r) => (
          <Link key={r.id} href={`/gestao/reunioes/${r.id}`} className="linha-lista flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50">
            <div className="linha-principal min-w-0 flex-1">
              <p className="truncate font-medium text-gray-900">{r.confidencial && <span title="Confidencial">🔒 </span>}{r.titulo}</p>
              <p className="text-xs text-gray-500">{tipoLabel(r.tipo)}{r.local ? ` · ${r.local}` : ""}</p>
            </div>
            <span className="w-36 text-xs text-gray-600">{dataHoraCurta(r.data_hora)}</span>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_REUNIAO[r.status].cls}`}>{STATUS_REUNIAO[r.status].label}</span>
          </Link>
        ))}
      </div>

      {nova && <NovaReuniao onClose={() => setNova(false)} />}
    </div>
  );
}
