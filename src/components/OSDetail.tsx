"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity } from "@/lib/entities";
import { formatCurrency, formatDate } from "@/lib/format";
import Badge from "@/components/Badge";
import EntityForm from "@/components/EntityForm";

type Row = Record<string, any>;
const STATUS_OS = getEntity("ordens_servico")!.fields.find((f) => f.key === "status")!.options!;
const URGENCIA = getEntity("ordens_servico")!.fields.find((f) => f.key === "urgencia")!.options!;
const STATUS_ATIV = getEntity("atividades_os")!.fields.find((f) => f.key === "status")!.options!;

export default function OSDetail({ osId }: { osId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [os, setOs] = useState<Row | null>(null);
  const [atividades, setAtividades] = useState<Row[]>([]);
  const [insumos, setInsumos] = useState<Row[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [colaboradores, setColaboradores] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [contratos, setContratos] = useState<any[]>([]);
  const [propostas, setPropostas] = useState<any[]>([]);
  const [drawer, setDrawer] = useState<null | { tipo: "os" | "atividade" | "insumo"; registro: Row | null }>(null);
  const [carregando, setCarregando] = useState(true);

  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);
  const colNome = useMemo(() => Object.fromEntries(colaboradores.map((c) => [c.id, c.nome])), [colaboradores]);
  const prodNome = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p.nome])), [produtos]);
  const ctrNum = useMemo(() => Object.fromEntries(contratos.map((c) => [c.id, c.numero])), [contratos]);
  const propNum = useMemo(() => Object.fromEntries(propostas.map((p) => [p.id, p.numero])), [propostas]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [o, a, i] = await Promise.all([
      supabase.from("ordens_servico").select("*").eq("id", osId).maybeSingle(),
      supabase.from("atividades_os").select("*").eq("os_id", osId).order("data_inicio", { ascending: true, nullsFirst: false }),
      supabase.from("insumos_os").select("*").eq("os_id", osId).order("descricao"),
    ]);
    setOs(o.data); setAtividades(a.data ?? []); setInsumos(i.data ?? []);
    setCarregando(false);
  }, [supabase, osId]);

  useEffect(() => {
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
    supabase.from("colaboradores").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setColaboradores(data ?? []));
    supabase.from("produtos").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setProdutos(data ?? []));
    supabase.from("contratos").select("id, numero").order("data_inicio", { ascending: false }).range(0, 4999).then(({ data }) => setContratos(data ?? []));
    supabase.from("propostas").select("id, numero").order("data", { ascending: false }).range(0, 4999).then(({ data }) => setPropostas(data ?? []));
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  async function excluirOS() {
    if (!confirm("Excluir esta OS e todas as atividades/insumos?")) return;
    await supabase.from("ordens_servico").delete().eq("id", osId);
    router.push("/os");
  }
  async function excluir(tabela: string, id: string) {
    if (!confirm("Excluir?")) return;
    await supabase.from(tabela).delete().eq("id", id);
    carregar();
  }

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!os) return <p className="text-gray-400">OS não encontrada. <Link href="/os" className="text-brand-600">voltar</Link></p>;

  const custoInsumos = insumos.reduce((s, r) => s + Number(r.custo_total || 0), 0);
  const progresso = atividades.length ? Math.round(atividades.reduce((s, a) => s + Number(a.conclusao_pct || 0), 0) / atividades.length) : 0;

  const refFor = (tipo: string): Record<string, { value: string; label: string }[]> =>
    tipo === "os" ? {
      cliente_id: clientes.map((c) => ({ value: c.id, label: c.nome })),
      contrato_id: contratos.map((c) => ({ value: c.id, label: c.numero })),
      proposta_id: propostas.map((p) => ({ value: p.id, label: p.numero })),
    }
    : tipo === "atividade" ? { colaborador_id: colaboradores.map((c) => ({ value: c.id, label: c.nome })) }
    : { produto_id: produtos.map((p) => ({ value: p.id, label: p.nome })) };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/os" className="hover:text-gray-700">Ordens de Serviço</Link> <span>/</span> <span className="text-gray-600">{os.titulo}</span>
      </div>

      {/* cabeçalho */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{os.numero ? `${os.numero} · ` : ""}{os.titulo}</h1>
            <p className="mt-1 text-sm text-gray-500">{cliNome[os.cliente_id] ?? "—"}{os.local ? ` · ${os.local}` : ""}</p>
            <div className="mt-1 flex flex-wrap gap-3 text-xs">
              {os.contrato_id && <Link href={`/contratos/${os.contrato_id}`} className="text-brand-600 hover:underline">📜 Contrato {ctrNum[os.contrato_id] ?? ""}</Link>}
              {os.proposta_id && <Link href={`/propostas/${os.proposta_id}`} className="text-brand-600 hover:underline">📑 Proposta {propNum[os.proposta_id] ?? ""}</Link>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge value={os.urgencia} options={URGENCIA} />
            <Badge value={os.status} options={STATUS_OS} />
            <Link href={`/os/${osId}/documento`} className="btn-ghost text-sm ring-1 ring-gray-200">🖨️ Imprimir OS</Link>
            <button className="btn-ghost text-sm" onClick={() => setDrawer({ tipo: "os", registro: os })}>Editar</button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Info rot="Responsável" val={os.responsavel} />
          <Info rot="Prazo" val={formatDate(os.prazo)} />
          <Info rot="Custo estimado" val={formatCurrency(os.custo_estimado)} />
          <Info rot="Custo de insumos" val={formatCurrency(custoInsumos)} />
        </div>
        {(os.motivo || os.como_sera_feito) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 text-sm">
            {os.motivo && <div><p className="text-xs text-gray-400">Por quê</p><p className="text-gray-700">{os.motivo}</p></div>}
            {os.como_sera_feito && <div><p className="text-xs text-gray-400">Como será feito</p><p className="text-gray-700">{os.como_sera_feito}</p></div>}
          </div>
        )}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-gray-400"><span>Progresso das atividades</span><span>{progresso}%</span></div>
          <div className="mt-1 h-2 w-full rounded-full bg-gray-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${progresso}%` }} /></div>
        </div>
      </div>

      {/* atividades */}
      <Secao titulo="Atividades" onAdd={() => setDrawer({ tipo: "atividade", registro: null })}>
        {atividades.length === 0 ? <Vazio texto="Nenhuma atividade." /> : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">Atividade</th><th className="px-4 py-2">Responsável</th><th className="px-4 py-2">Prazo</th><th className="px-4 py-2 text-right">%</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">Ações</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {atividades.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">{a.descricao}</td>
                  <td className="px-4 py-2 text-gray-600">{colNome[a.colaborador_id] ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{formatDate(a.data_fim)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(a.conclusao_pct || 0)}%</td>
                  <td className="px-4 py-2"><Badge value={a.status} options={STATUS_ATIV} /></td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button className="text-brand-600 hover:underline" onClick={() => setDrawer({ tipo: "atividade", registro: a })}>Editar</button>
                    <button className="ml-3 text-red-500 hover:underline" onClick={() => excluir("atividades_os", a.id)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Secao>

      {/* insumos */}
      <Secao titulo={`Insumos · ${formatCurrency(custoInsumos)}`} onAdd={() => setDrawer({ tipo: "insumo", registro: null })}>
        {insumos.length === 0 ? <Vazio texto="Nenhum insumo." /> : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">Insumo</th><th className="px-4 py-2">Produto</th><th className="px-4 py-2 text-right">Qtd</th><th className="px-4 py-2 text-right">Custo un.</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Ações</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {insumos.map((i) => (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">{i.descricao}</td>
                  <td className="px-4 py-2 text-gray-600">{prodNome[i.produto_id] ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(i.quantidade)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(i.custo_unitario)}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">{formatCurrency(i.custo_total)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button className="text-brand-600 hover:underline" onClick={() => setDrawer({ tipo: "insumo", registro: i })}>Editar</button>
                    <button className="ml-3 text-red-500 hover:underline" onClick={() => excluir("insumos_os", i.id)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Secao>

      <button className="text-sm text-red-500 hover:underline" onClick={excluirOS}>Excluir esta OS</button>

      {drawer && (
        <EntityForm
          entity={getEntity(drawer.tipo === "os" ? "ordens_servico" : drawer.tipo === "atividade" ? "atividades_os" : "insumos_os")!}
          registro={drawer.registro}
          refOptions={refFor(drawer.tipo)}
          fixedValues={drawer.tipo === "os" ? undefined : { os_id: osId }}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); carregar(); }}
        />
      )}
    </div>
  );
}

function Info({ rot, val }: { rot: string; val: any }) {
  return <div><p className="text-xs text-gray-400">{rot}</p><p className="font-medium text-gray-800">{val || "—"}</p></div>;
}
function Secao({ titulo, onAdd, children }: { titulo: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{titulo}</h2>
        <button className="btn-ghost text-sm text-brand-600" onClick={onAdd}>+ Adicionar</button>
      </div>
      <div className="card overflow-x-auto">{children}</div>
    </section>
  );
}
function Vazio({ texto }: { texto: string }) {
  return <div className="px-4 py-8 text-center text-sm text-gray-400">{texto}</div>;
}
