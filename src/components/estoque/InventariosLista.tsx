"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePode } from "@/components/AcessoProvider";
import Badge from "@/components/Badge";
import { formatDate } from "@/lib/format";

type Inventario = {
  id: string; numero: string | null; deposito_id: string; tipo: "saldo_inicial" | "contagem";
  data: string; status: string; observacao: string | null; confirmado_em: string | null;
};

export const TIPO_INV = [
  { value: "saldo_inicial", label: "Saldo inicial", color: "purple" },
  { value: "contagem", label: "Contagem", color: "blue" },
];
export const STATUS_INV = [
  { value: "rascunho", label: "Em contagem", color: "amber" },
  { value: "confirmado", label: "Confirmado", color: "green" },
  { value: "cancelado", label: "Cancelado", color: "gray" },
];

// Lista de inventários + criação (saldo inicial ou contagem de um depósito).
export default function InventariosLista() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const podeEditar = usePode("estoque", "editar");
  const [lista, setLista] = useState<Inventario[]>([]);
  const [depositos, setDepositos] = useState<{ id: string; nome: string }[]>([]);
  const [contagem, setContagem] = useState<Record<string, { itens: number; contados: number }>>({});
  const [criando, setCriando] = useState(false);
  const [deposito, setDeposito] = useState("");
  const [tipo, setTipo] = useState<"saldo_inicial" | "contagem">("contagem");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [i, d, it] = await Promise.all([
      supabase.from("inventarios").select("*").order("criado_em", { ascending: false }).limit(200),
      supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("inventario_itens").select("inventario_id, quantidade_contada").range(0, 49999),
    ]);
    if (i.error) setErro(i.error.message);
    setLista((i.data ?? []) as Inventario[]);
    setDepositos(d.data ?? []);
    const c: Record<string, { itens: number; contados: number }> = {};
    for (const r of (it.data ?? []) as any[]) {
      const x = (c[r.inventario_id] ??= { itens: 0, contados: 0 });
      x.itens++; if (r.quantidade_contada != null) x.contados++;
    }
    setContagem(c);
    setDeposito((atual) => atual || d.data?.[0]?.id || "");
  }, [supabase]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.from("inventarios")
      .insert({ deposito_id: deposito, tipo, observacao: obs.trim() || null }).select("id").single();
    if (error) { setErro(error.message); return; }
    router.push(`/estoque/inventario/${data.id}`);
  }

  const depNome = Object.fromEntries(depositos.map((d) => [d.id, d.nome]));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">📋 Inventário e saldo inicial</h1>
          <p className="text-sm text-gray-500">Conte o estoque, compare com o sistema e confirme para acertar os saldos.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/estoque/saldos" className="btn-ghost text-sm ring-1 ring-gray-200">📊 Saldos</Link>
          {podeEditar && <button className="btn-primary text-sm" onClick={() => setCriando(true)}>+ Novo inventário</button>}
        </div>
      </div>

      {erro && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {criando && (
        <form onSubmit={criar} className="card space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="lbl">Depósito</span>
              <select className="inp" required value={deposito} onChange={(e) => setDeposito(e.target.value)}>
                {depositos.length === 0 && <option value="">Cadastre um depósito primeiro</option>}
                {depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="lbl">Tipo</span>
              <select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
                <option value="saldo_inicial">Saldo inicial (implantação do estoque)</option>
                <option value="contagem">Contagem (inventário periódico)</option>
              </select>
            </label>
          </div>
          <input className="inp" placeholder="Observação (opcional) — ex.: contagem de fim de mês, seção EPIs" value={obs} onChange={(e) => setObs(e.target.value)} />
          <p className="text-xs text-gray-500">
            {tipo === "saldo_inicial"
              ? "Saldo inicial: cole a planilha com os produtos e quantidades. A gerência pode informar o custo de cada item."
              : "Contagem: carregue os produtos do depósito, imprima a folha de contagem e lance o que foi contado."}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setCriando(false)}>Cancelar</button>
            <button className="btn-primary" disabled={!deposito}>Criar e abrir</button>
          </div>
        </form>
      )}

      <div className="card divide-y divide-gray-100 overflow-hidden">
        {lista.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">Nenhum inventário ainda.</p>
        ) : lista.map((i) => {
          const c = contagem[i.id] ?? { itens: 0, contados: 0 };
          return (
            <Link key={i.id} href={`/estoque/inventario/${i.id}`} className="linha-lista flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
              <div className="linha-principal min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900">{i.numero ?? "Inventário"} · {depNome[i.deposito_id] ?? "—"}</p>
                <p className="truncate text-xs text-gray-400">{c.contados}/{c.itens} item(ns) contado(s){i.observacao ? ` · ${i.observacao}` : ""}</p>
              </div>
              <div className="w-24 shrink-0 text-right text-xs text-gray-500">{formatDate(i.data)}</div>
              <div className="w-28 shrink-0 text-right"><Badge value={i.tipo} options={TIPO_INV} /></div>
              <div className="w-28 shrink-0 text-right"><Badge value={i.status} options={STATUS_INV} /></div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
