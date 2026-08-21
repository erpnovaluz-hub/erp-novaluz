"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/format";

type Row = Record<string, any>;

export default function PainelObras() {
  const supabase = useMemo(() => createClient(), []);
  const [obras, setObras] = useState<Row[]>([]);
  const [ativs, setAtivs] = useState<Row[]>([]);
  const [colNome, setColNome] = useState<Record<string, string>>({});
  const [cliNome, setCliNome] = useState<Record<string, string>>({});
  const [relogio, setRelogio] = useState<Date>(new Date());
  const [atualizado, setAtualizado] = useState<Date>(new Date());

  const carregar = useCallback(async () => {
    const { data: os } = await supabase.from("ordens_servico").select("*")
      .eq("is_obra", true).not("status", "in", "(concluida,cancelada)").order("prazo", { ascending: true, nullsFirst: false });
    const lista = os ?? [];
    setObras(lista);
    const ids = lista.map((o: any) => o.id);
    if (ids.length) {
      const { data: a } = await supabase.from("atividades_os").select("os_id, descricao, colaborador_id, status, conclusao_pct").in("os_id", ids);
      setAtivs(a ?? []);
    } else setAtivs([]);
    const [c, cl] = await Promise.all([
      supabase.from("colaboradores").select("id, nome").range(0, 4999),
      supabase.from("clientes").select("id, nome").range(0, 4999),
    ]);
    setColNome(Object.fromEntries((c.data ?? []).map((x: any) => [x.id, x.nome])));
    setCliNome(Object.fromEntries((cl.data ?? []).map((x: any) => [x.id, x.nome])));
    setAtualizado(new Date());
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);
  // auto-atualiza os dados a cada 60s e o relógio a cada 1s
  useEffect(() => {
    const d = setInterval(carregar, 60000);
    const r = setInterval(() => setRelogio(new Date()), 1000);
    return () => { clearInterval(d); clearInterval(r); };
  }, [carregar]);

  function dados(obra: Row) {
    const as = ativs.filter((a) => a.os_id === obra.id);
    const prog = as.length ? Math.round(as.reduce((s, a) => s + Number(a.conclusao_pct || 0), 0) / as.length) : 0;
    const equipe = Array.from(new Set(as.map((a) => a.colaborador_id).filter(Boolean))).map((idc) => colNome[idc as string] ?? "—");
    const parados = as.filter((a) => a.status === "parado").map((a) => a.descricao);
    return { prog, equipe, parados };
  }

  return (
    <div className="min-h-screen">
      {/* Cabeçalho estilo TV */}
      <div className="no-print -mx-4 -mt-4 mb-5 flex items-center justify-between bg-brand-700 px-6 py-4 text-white md:-mx-6 md:-mt-6">
        <h1 className="text-2xl font-bold">🏗️ Obras em andamento</h1>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums">{relogio.toLocaleTimeString("pt-BR")}</p>
          <p className="text-xs text-brand-100">atualizado {atualizado.toLocaleTimeString("pt-BR")}</p>
        </div>
      </div>

      {obras.length === 0 ? (
        <div className="card p-16 text-center text-lg text-gray-400">Nenhuma obra em andamento. Marque uma OS como <b>“É obra?”</b> e coloque em execução.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {obras.map((o) => {
            const d = dados(o);
            const atrasada = o.prazo && o.prazo < new Date().toISOString().slice(0, 10);
            return (
              <Link key={o.id} href={`/os/${o.id}`} className="card block p-5 transition hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{o.titulo}</h2>
                    <p className="text-sm text-gray-500">{cliNome[o.cliente_id] ?? ""}{o.local ? ` · ${o.local}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm ${atrasada ? "font-semibold text-red-600" : "text-gray-500"}`}>Prazo: {formatDate(o.prazo)}{atrasada ? " ⚠" : ""}</p>
                    {o.responsavel && <p className="text-sm text-gray-500">Resp.: {o.responsavel}</p>}
                  </div>
                </div>

                {/* progresso */}
                <div className="mt-3">
                  <div className="flex justify-between text-sm text-gray-500"><span>Progresso</span><span className="font-semibold">{d.prog}%</span></div>
                  <div className="mt-1 h-3 w-full rounded-full bg-gray-100"><div className="h-3 rounded-full bg-brand-500" style={{ width: `${d.prog}%` }} /></div>
                </div>

                {/* equipe */}
                {d.equipe.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase text-gray-400">Equipe ({d.equipe.length})</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {d.equipe.map((nome, i) => <span key={i} className="rounded-full bg-gray-100 px-2 py-1 text-sm text-gray-700">👷 {nome}</span>)}
                    </div>
                  </div>
                )}

                {/* gargalos */}
                {(o.gargalos || d.parados.length > 0) && (
                  <div className="mt-3 rounded-lg bg-amber-50 p-3">
                    <p className="text-xs font-semibold uppercase text-amber-700">🚧 Gargalos / atenção</p>
                    {o.gargalos && <p className="mt-1 text-sm text-amber-800">{o.gargalos}</p>}
                    {d.parados.map((p, i) => <p key={i} className="mt-0.5 text-sm text-amber-800">• {p} (parada)</p>)}
                  </div>
                )}

                {/* orientações */}
                {o.orientacoes && (
                  <div className="mt-3 rounded-lg bg-blue-50 p-3">
                    <p className="text-xs font-semibold uppercase text-blue-700">📋 Cuidados / orientações</p>
                    <p className="mt-1 text-sm text-blue-800">{o.orientacoes}</p>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
