"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import { STATUS_OS_ATIVOS } from "@/lib/os";
import { normalizar } from "@/lib/planilha";
import ApontarForm from "@/components/os/ApontarForm";

type OS = { id: string; numero: string | null; titulo: string };

// Tela rápida de campo: escolhe a OS e aponta as horas da equipe (celular).
export default function ApontarHoras() {
  const supabase = useMemo(() => createClient(), []);
  const podeEditar = usePode("os", "editar");
  const [oss, setOss] = useState<OS[]>([]);
  const [busca, setBusca] = useState("");
  const [os, setOs] = useState<OS | null>(null);
  const [atividades, setAtividades] = useState<any[]>([]);
  const [hoje, setHoje] = useState<any[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const carregarHoje = useCallback(async () => {
    const d = new Date(); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const { data } = await supabase.from("os_apontamentos").select("id, os_id, colaborador_id, horas, tipo").eq("data", iso).order("criado_em", { ascending: false }).limit(200);
    setHoje(data ?? []);
  }, [supabase]);

  useEffect(() => {
    supabase.from("ordens_servico").select("id, numero, titulo").in("status", STATUS_OS_ATIVOS).order("numero", { ascending: false }).range(0, 999)
      .then(({ data }) => setOss((data ?? []) as OS[]));
    supabase.from("vw_equipe").select("id, nome").range(0, 4999)
      .then(({ data }) => setNomes(Object.fromEntries(((data ?? []) as any[]).map((x) => [x.id, x.nome]))));
    carregarHoje();
  }, [supabase, carregarHoje]);

  useEffect(() => {
    if (!os) { setAtividades([]); return; }
    supabase.from("atividades_os").select("id, descricao, conclusao_pct").eq("os_id", os.id).order("data_inicio", { ascending: true, nullsFirst: false })
      .then(({ data }) => setAtividades(data ?? []));
  }, [supabase, os]);

  const filtradas = oss.filter((o) => { const q = normalizar(busca); return !q || normalizar(o.titulo).includes(q) || normalizar(o.numero).includes(q); });
  const osNome = Object.fromEntries(oss.map((o) => [o.id, [o.numero, o.titulo].filter(Boolean).join(" · ")]));
  const totalHoje = hoje.reduce((s, a) => s + Number(a.horas), 0);

  if (!podeEditar) return <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-gray-500">Seu perfil não registra horas em OS.</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">⏱️ Apontar horas</h1>
        <p className="text-sm text-gray-500">Escolha a OS e marque quem trabalhou nela.</p>
      </div>
      {msg && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</div>}

      <div className="card space-y-3 p-4">
        {!os ? (
          <>
            <input className="inp" placeholder="Buscar OS por número ou título…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border text-sm">
              {filtradas.length === 0 ? <li className="px-3 py-4 text-center text-gray-400">Nenhuma OS em aberto.</li>
                : filtradas.map((o) => (
                  <li key={o.id}>
                    <button className="w-full px-3 py-3 text-left hover:bg-gray-50" onClick={() => { setOs(o); setMsg(null); }}>
                      {o.numero && <span className="mr-2 text-xs text-gray-400">{o.numero}</span>}{o.titulo}
                    </button>
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm">
              <span className="font-medium text-brand-800">{[os.numero, os.titulo].filter(Boolean).join(" · ")}</span>
              <button className="text-xs text-brand-700 underline" onClick={() => setOs(null)}>trocar OS</button>
            </div>
            <ApontarForm osId={os.id} atividades={atividades}
              onSalvo={(n) => { setMsg(`✓ ${n} apontamento(s) em ${os.numero ?? os.titulo}.`); carregarHoje(); }} />
            <Link href={`/os/${os.id}`} className="block text-center text-xs text-brand-600 hover:underline">abrir a OS</Link>
          </>
        )}
      </div>

      <section>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Hoje · {totalHoje.toLocaleString("pt-BR")} h</h2>
        <div className="card divide-y divide-gray-100 text-sm">
          {hoje.length === 0 ? <p className="px-4 py-5 text-center text-gray-400">Nada apontado hoje.</p>
            : hoje.map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1 truncate">{nomes[a.colaborador_id] ?? "—"} <span className="text-xs text-gray-400">· {osNome[a.os_id] ?? "OS"}</span></span>
                <span className="font-medium tabular-nums">{Number(a.horas).toLocaleString("pt-BR")} h</span>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
