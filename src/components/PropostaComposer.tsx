"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getEntity } from "@/lib/entities";
import { formatCurrency, formatDate } from "@/lib/format";
import Badge from "@/components/Badge";
import EntityForm from "@/components/EntityForm";
import ItemPropostaDrawer from "@/components/ItemPropostaDrawer";
import { CLAUSULAS_PADRAO } from "@/lib/contrato";

type Row = Record<string, any>;
const STATUS = getEntity("propostas")!.fields.find((f) => f.key === "status")!.options!;

export default function PropostaComposer({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [prop, setProp] = useState<Row | null>(null);
  const [itens, setItens] = useState<Row[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [drawer, setDrawer] = useState<null | { tipo: "prop" | "item"; registro: Row | null }>(null);
  const [carregando, setCarregando] = useState(true);

  const cliNome = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c.nome])), [clientes]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [p, it] = await Promise.all([
      supabase.from("propostas").select("*").eq("id", id).maybeSingle(),
      supabase.from("itens_proposta").select("*").eq("proposta_id", id).order("ordem", { ascending: true }),
    ]);
    setProp(p.data); setItens(it.data ?? []); setCarregando(false);
  }, [supabase, id]);

  useEffect(() => {
    supabase.from("clientes").select("id, nome").order("nome").range(0, 4999).then(({ data }) => setClientes(data ?? []));
    supabase.from("produtos").select("id, nome, preco_sugerido, custo_direto").eq("ativo", true).order("nome").range(0, 4999).then(({ data }) => setProdutos(data ?? []));
  }, [supabase]);
  useEffect(() => { carregar(); }, [carregar]);

  async function excluirProp() {
    if (!confirm("Excluir esta proposta e seus itens?")) return;
    await supabase.from("propostas").delete().eq("id", id);
    router.push("/propostas");
  }
  async function excluirItem(itemId: string) {
    if (!confirm("Excluir item?")) return;
    await supabase.from("itens_proposta").delete().eq("id", itemId);
    carregar();
  }
  async function gerarContrato() {
    if (!prop) return;
    if (!confirm("Gerar um contrato a partir desta proposta?")) return;
    const { data, error } = await supabase.from("contratos").insert({
      cliente_id: prop.cliente_id, proposta_id: prop.id,
      numero: prop.numero ? `C-${prop.numero}` : null,
      data_inicio: new Date().toISOString().slice(0, 10), tipo: "pontual",
      valor: prop.valor_total, status: "ativo",
      objeto: prop.objeto, escopo_desc: prop.escopo_desc || prop.apresentacao,
      condicoes: prop.pagamento, clausulas: CLAUSULAS_PADRAO,
    }).select("id").single();
    if (error) { alert(error.message); return; }
    router.push(`/contratos/${data.id}`);
  }

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!prop) return <p className="text-gray-400">Proposta não encontrada. <Link href="/propostas" className="text-brand-600">voltar</Link></p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Link href="/propostas" className="hover:text-gray-700">Propostas</Link> <span>/</span> <span className="text-gray-600">{prop.numero || "(sem número)"}</span>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{prop.numero || "(sem número)"} · {cliNome[prop.cliente_id] ?? "—"}</h1>
            <p className="mt-1 text-sm text-gray-500">{prop.objeto || "sem objeto"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge value={prop.status} options={STATUS} />
            <Link href={`/propostas/${id}/documento`} className="btn-primary text-sm">📄 Documento / PDF</Link>
            <button className="btn-ghost text-sm ring-1 ring-gray-200" onClick={gerarContrato}>📜 Gerar contrato</button>
            <button className="btn-ghost text-sm" onClick={() => setDrawer({ tipo: "prop", registro: prop })}>Editar</button>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Info rot="Emissão" val={formatDate(prop.data)} />
          <Info rot="Válido até" val={formatDate(prop.validade)} />
          <Info rot="Valor total" val={formatCurrency(prop.valor_total)} />
          <Info rot="Pagamento" val={prop.pagamento} />
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Itens / escopo e preços</h2>
          <button className="btn-ghost text-sm text-brand-600" onClick={() => setDrawer({ tipo: "item", registro: { ordem: itens.length + 1 } })}>+ Adicionar item</button>
        </div>
        <div className="card overflow-x-auto">
          {itens.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">Nenhum item.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr><th className="px-4 py-2">Descrição</th><th className="px-4 py-2">Ref.</th><th className="px-4 py-2 text-right">Qtd</th><th className="px-4 py-2 text-right">Vlr unit.</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2 text-right">Ações</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itens.map((it) => (
                  <tr key={it.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 max-w-md">{it.descricao}</td>
                    <td className="px-4 py-2 text-gray-500">{it.referencia ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{Number(it.quantidade)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(it.valor_unit)}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatCurrency(it.valor_total)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button className="text-brand-600 hover:underline" onClick={() => setDrawer({ tipo: "item", registro: it })}>Editar</button>
                      <button className="ml-3 text-red-500 hover:underline" onClick={() => excluirItem(it.id)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <tr><td className="px-4 py-2" colSpan={4}>Valor total</td><td className="px-4 py-2 text-right tabular-nums text-brand-600">{formatCurrency(prop.valor_total)}</td><td /></tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>

      <button className="text-sm text-red-500 hover:underline" onClick={excluirProp}>Excluir esta proposta</button>

      {drawer?.tipo === "prop" && (
        <EntityForm
          entity={getEntity("propostas")!}
          registro={drawer.registro}
          refOptions={{ cliente_id: clientes.map((c) => ({ value: c.id, label: c.nome })) }}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); carregar(); }}
        />
      )}
      {drawer?.tipo === "item" && (
        <ItemPropostaDrawer
          registro={drawer.registro ?? {}}
          propostaId={id}
          produtos={produtos}
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
