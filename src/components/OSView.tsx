"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity } from "@/lib/entities";
import { formatDate } from "@/lib/format";
import { buscarTodos } from "@/lib/supabase/buscarTodos";
import { STATUS_OS, motivoPausaLabel, osAtrasada } from "@/lib/os";
import { usePode } from "@/components/AcessoProvider";
import { Avatar, useEquipe } from "@/components/tarefas/comum";
import Badge from "@/components/Badge";
import EntityForm from "@/components/EntityForm";
import PausaModal from "@/components/os/PausaModal";
import StatusOSPicker from "@/components/os/StatusOSPicker";

type Row = Record<string, any>;
type Visao = "lista" | "quadro";
const URGENCIA = [
  { value: "baixa", label: "Baixa", color: "gray" },
  { value: "media", label: "Média", color: "amber" },
  { value: "alta", label: "Alta", color: "red" },
];
const ENCERRADAS = ["concluido", "faturada", "cancelado"];

export default function OSView() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const podeEditar = usePode("os", "editar");
  const { pessoas, porId } = useEquipe();
  const [rows, setRows] = useState<Row[]>([]);
  const [resumo, setResumo] = useState<Record<string, any>>({});
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([]);
  const [contratos, setContratos] = useState<{ id: string; numero: string }[]>([]);
  const [propostas, setPropostas] = useState<{ id: string; numero: string }[]>([]);
  const [visao, setVisao] = useState<Visao>("lista");
  const [cliente, setCliente] = useState("");
  const [status, setStatus] = useState("");
  const [resp, setResp] = useState("");
  const [soAtrasadas, setSoAtrasadas] = useState(false);
  const [verEncerradas, setVerEncerradas] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(false);
  const [pausar, setPausar] = useState<Row | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);

  useEffect(() => {
    try { const v = localStorage.getItem("os.visao"); if (v === "lista" || v === "quadro") setVisao(v); } catch {}
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
    supabase.from("contratos").select("id, numero").order("data_inicio", { ascending: false }).range(0, 4999).then(({ data }) => setContratos(data ?? []));
    supabase.from("propostas").select("id, numero").order("data", { ascending: false }).range(0, 4999).then(({ data }) => setPropostas(data ?? []));
  }, [supabase]);
  function trocarVisao(v: Visao) { setVisao(v); try { localStorage.setItem("os.visao", v); } catch {} }

  const carregar = useCallback(async () => {
    setCarregando(true);
    let q = supabase.from("ordens_servico").select("*");
    if (cliente) q = q.eq("cliente_id", cliente);
    if (status) q = q.eq("status", status);
    else if (!verEncerradas) {
      // No quadro a coluna "Concluída" mostra as concluídas nos últimos 30 dias (aguardando faturamento)
      if (visao === "quadro") {
        const d = new Date(Date.now() - 30 * 86400000);
        const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        q = q.or(`status.not.in.(${ENCERRADAS.join(",")}),and(status.eq.concluido,data_realizado.gte.${desde})`);
      } else q = q.not("status", "in", `(${ENCERRADAS.join(",")})`);
    }
    if (resp) q = resp === "ninguem" ? q.is("responsavel_id", null) : q.eq("responsavel_id", resp);
    if (buscaAtiva.trim()) q = q.or(`titulo.ilike.%${buscaAtiva.trim()}%,numero.ilike.%${buscaAtiva.trim()}%`);
    const [{ data }, r] = await Promise.all([
      buscarTodos(q.order("prazo", { ascending: true, nullsFirst: false })),
      buscarTodos(supabase.from("vw_os_resumo").select("*"), "os_id"),
    ]);
    setRows(data ?? []);
    setResumo(Object.fromEntries((r.data ?? []).map((x: any) => [x.os_id, x])));
    setCarregando(false);
  }, [supabase, cliente, status, resp, buscaAtiva, verEncerradas, visao]);

  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(() => rows.filter((r) => !soAtrasadas || osAtrasada(r)), [rows, soAtrasadas]);
  const nAtrasadas = rows.filter(osAtrasada).length;

  async function mudarStatus(os: Row, novoStatus: string, motivo?: string, obs?: string) {
    if (novoStatus === os.status) return;
    if (novoStatus === "pausada" && !motivo) { setPausar(os); return; }
    setErro(null);
    setRows((l) => l.map((x) => (x.id === os.id ? { ...x, status: novoStatus, motivo_pausa: motivo ?? null } : x)));
    const { error } = await supabase.from("ordens_servico")
      .update({ status: novoStatus, motivo_pausa: motivo ?? null, pausa_obs: obs || null }).eq("id", os.id);
    if (error) setErro(error.message);
    carregar();
  }

  const colunas = STATUS_OS.filter((s) => (verEncerradas ? true : !ENCERRADAS.includes(s.value) || s.value === "concluido"));

  const nomeResp = (r: Row) => (r.responsavel_id ? porId[r.responsavel_id]?.nome || porId[r.responsavel_id]?.email : r.responsavel) || null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">📋 Ordens de Serviço</h1>
          {nAtrasadas > 0 && <p className="text-sm text-red-600">⚠ {nAtrasadas} atrasada(s)</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg ring-1 ring-gray-200">
            {([["lista", "☰ Lista"], ["quadro", "▦ Quadro"]] as [Visao, string][]).map(([k, l]) => (
              <button key={k} onClick={() => trocarVisao(k)}
                className={`px-3 py-1.5 text-sm first:rounded-l-lg last:rounded-r-lg ${visao === k ? "bg-brand-600 text-white" : "text-gray-600"}`}>{l}</button>
            ))}
          </div>
          {podeEditar && <button className="btn-primary" onClick={() => setNovo(true)}>+ Nova OS</button>}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="inp !w-auto py-1.5" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="inp !w-auto py-1.5" value={resp} onChange={(e) => setResp(e.target.value)}>
          <option value="">Todos os responsáveis</option>
          <option value="ninguem">Sem responsável</option>
          {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome || p.email}</option>)}
        </select>
        {visao === "lista" && (
          <select className="inp !w-auto py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{verEncerradas ? "Todos os status" : "Em aberto"}</option>
            {STATUS_OS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        <form onSubmit={(e) => { e.preventDefault(); setBuscaAtiva(busca); }}>
          <input className="inp !w-52 py-1.5" placeholder="Buscar título ou nº…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </form>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={soAtrasadas} onChange={(e) => setSoAtrasadas(e.target.checked)} /> só atrasadas
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={verEncerradas} onChange={(e) => setVerEncerradas(e.target.checked)} /> mostrar encerradas
        </label>
      </div>

      {erro && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {carregando ? (
        <div className="card px-4 py-12 text-center text-gray-400">Carregando…</div>
      ) : visao === "lista" ? (
        <div className="card">
          {visiveis.length === 0 ? <div className="px-4 py-12 text-center text-gray-400">Nenhuma OS.</div> : (
            <ul className="divide-y divide-gray-100">
              {visiveis.map((r) => {
                const prog = Number(resumo[r.id]?.progresso_pct || 0);
                const atrasada = osAtrasada(r);
                const nome = nomeResp(r);
                return (
                  <li key={r.id}>
                    <Link href={`/os/${r.id}`} className="linha-lista flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                      <div className="linha-principal min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900">{r.numero ? <span className="mr-1.5 text-xs text-gray-400">{r.numero}</span> : null}{r.titulo}</p>
                        <p className="truncate text-xs text-gray-400">
                          {cliNome[r.cliente_id] ?? "—"}{nome ? ` · 👤 ${nome}` : " · sem responsável"}
                          {r.status === "pausada" && r.motivo_pausa ? ` · ⏸️ ${motivoPausaLabel(r.motivo_pausa)}` : ""}
                        </p>
                      </div>
                      <div className="hidden w-28 shrink-0 sm:block">
                        <div className="h-1.5 w-full rounded-full bg-gray-100">
                          <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.min(100, prog)}%` }} />
                        </div>
                        <p className="mt-1 text-right text-[10px] text-gray-400">{prog}%</p>
                      </div>
                      <div className={`w-24 shrink-0 text-right text-xs ${atrasada ? "font-medium text-red-600" : "text-gray-500"}`}>{formatDate(r.prazo)}{atrasada ? " ⚠" : ""}</div>
                      <div className="w-20 shrink-0 text-right"><Badge value={r.urgencia} options={URGENCIA} /></div>
                      <div className="w-36 shrink-0 text-right"><StatusOSPicker os={r as any} variante="menu" onChange={carregar} /></div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-4 sm:mx-0 sm:snap-none sm:px-0">
          {colunas.map((col) => {
            const itens = visiveis.filter((r) => r.status === col.value);
            return (
              <div key={col.value}
                onDragOver={(e) => { if (podeEditar) e.preventDefault(); }}
                onDrop={(e) => { const id = e.dataTransfer.getData("text/os"); const os = rows.find((x) => x.id === id); if (os) mudarStatus(os, col.value); }}
                className="flex w-[85vw] max-w-[18rem] shrink-0 snap-start flex-col rounded-xl bg-gray-100 p-2 sm:w-72">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <Badge value={col.value} options={STATUS_OS} />
                  <span className="text-xs text-gray-500">{itens.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {itens.map((r) => {
                    const atrasada = osAtrasada(r);
                    const prog = Number(resumo[r.id]?.progresso_pct || 0);
                    return (
                      <div key={r.id} draggable={podeEditar}
                        onDragStart={(e) => { e.dataTransfer.setData("text/os", r.id); e.dataTransfer.effectAllowed = "move"; }}
                        onClick={() => router.push(`/os/${r.id}`)}
                        className={`cursor-pointer rounded-lg border bg-white p-3 text-sm shadow-sm hover:shadow ${atrasada ? "border-red-300" : "border-gray-200"}`}>
                        <p className="text-[11px] text-gray-400">{r.numero}</p>
                        <p className="font-medium text-gray-900">{r.titulo}</p>
                        <p className="mt-0.5 truncate text-xs text-gray-500">{cliNome[r.cliente_id] ?? "—"}</p>
                        {r.status === "pausada" && r.motivo_pausa && <p className="mt-1 text-xs text-amber-700">⏸️ {motivoPausaLabel(r.motivo_pausa)}</p>}
                        <div className="mt-2 h-1 w-full rounded-full bg-gray-100"><div className="h-1 rounded-full bg-brand-500" style={{ width: `${Math.min(100, prog)}%` }} /></div>
                        <div className="mt-2 flex items-center gap-2">
                          {r.urgencia === "alta" && <Badge value="alta" options={URGENCIA} />}
                          <span className={`ml-auto text-[11px] ${atrasada ? "font-medium text-red-600" : "text-gray-500"}`}>{formatDate(r.prazo)}{atrasada ? " ⚠" : ""}</span>
                          <Avatar pessoa={r.responsavel_id ? porId[r.responsavel_id] : null} size={20} />
                        </div>
                        <div className="mt-2 border-t pt-2 text-right">
                          <StatusOSPicker os={r as any} variante="menu" onChange={carregar} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {visao === "quadro" && podeEditar && <p className="mt-1 text-xs text-gray-400">No computador, arraste o cartão para mudar o status. No celular, abra a OS.</p>}

      {novo && (
        <EntityForm
          entity={getEntity("ordens_servico")!}
          registro={null}
          refOptions={{
            cliente_id: clientes.map((c) => ({ value: c.id, label: c.nome })),
            contrato_id: contratos.map((c) => ({ value: c.id, label: c.numero })),
            proposta_id: propostas.map((p) => ({ value: p.id, label: p.numero })),
            responsavel_id: pessoas.map((p) => ({ value: p.id, label: p.nome || p.email || "" })),
          }}
          onClose={() => setNovo(false)}
          onSaved={() => { setNovo(false); carregar(); }}
        />
      )}
      {pausar && (
        <PausaModal titulo={`${pausar.numero ?? ""} ${pausar.titulo}`} onCancelar={() => setPausar(null)}
          onConfirmar={(m, o) => { const os = pausar; setPausar(null); mudarStatus(os, "pausada", m, o); }} />
      )}
    </div>
  );
}
