"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso, usePode } from "@/components/AcessoProvider";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";
import Badge from "@/components/Badge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { STATUS_VALE_OPTS, TIPOS_VALE, qtdBR } from "@/lib/almox";

type Linha = {
  item_id: string; numero: string; tipo: "saida" | "devolucao" | "entrada"; status: string; data: string;
  deposito_nome: string | null; colaborador_nome: string | null; destino_tipo: string | null; destino_nome: string | null;
  fornecedor_nome: string | null; nota_fiscal: string | null; observacao: string | null;
  produto_codigo: string | null; produto_nome: string; unidade: string | null; quantidade: number;
  custo_unitario: number | null; valor: number | null;
};

// Vale impresso para assinatura (sem valores). Gerência vê os custos na tela.
export default function ValeDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const { gerencia } = useAcesso();
  const podeEditar = usePode("estoque", "editar");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [vale, setVale] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [l, v] = await Promise.all([
      supabase.from("vw_diario_almox").select("*").eq("vale_id", id).order("produto_nome"),
      supabase.from("vales_almox").select("*").eq("id", id).maybeSingle(),
    ]);
    setLinhas((l.data ?? []) as Linha[]);
    setVale(v.data);
    setCarregando(false);
  }, [supabase, id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function cancelar() {
    const motivo = window.prompt("Motivo do cancelamento (o estoque será estornado):");
    if (!motivo?.trim()) return;
    const { error } = await supabase.rpc("cancelar_vale", { p_vale: id, p_motivo: motivo.trim() });
    if (error) { setErro(error.message); return; }
    carregar();
  }

  if (carregando) return <div className="p-8 text-center text-sm text-gray-400">Carregando…</div>;
  if (!vale) return <div className="card mx-auto mt-10 max-w-md p-6 text-center text-sm text-gray-500">Vale não encontrado.</div>;

  const cfg = TIPOS_VALE.find((t) => t.key === vale.tipo)!;
  const h = linhas[0];
  const destinoRot = vale.destino_tipo === "os" ? "OS" : vale.destino_tipo === "obra" ? "Obra" : vale.destino_tipo === "setor" ? "Setor" : null;
  const total = linhas.reduce((s, x) => s + Number(x.valor ?? 0), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/estoque/balcao" className="hover:text-gray-700">Balcão</Link> <span>/</span>
          <Link href="/estoque/diario" className="hover:text-gray-700">Diário</Link> <span>/</span>
          <span className="text-gray-600">{vale.numero}</span>
        </div>
        <div className="flex gap-2">
          {podeEditar && vale.status === "ativo" && <button className="btn-ghost text-sm text-red-500" onClick={cancelar}>Cancelar vale</button>}
          <PrintButton label="Imprimir vale" />
        </div>
      </div>

      {erro && <div className="no-print rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}
      {vale.status === "cancelado" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ⚠ Vale <b>cancelado</b> em {formatDateTime(vale.cancelado_em)} — {vale.motivo_cancelamento}. O estoque foi estornado.
        </div>
      )}

      <div className="doc rounded-xl bg-white p-6 text-gray-800 shadow-sm sm:p-8 print:p-0 print:shadow-none">
        <DocHeader titulo={cfg.titulo} numero={vale.numero} subtitulo={formatDateTime(vale.data)} />

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Campo rot="Depósito" val={h?.deposito_nome} />
          <div className="no-print"><Badge value={vale.status} options={STATUS_VALE_OPTS} /></div>
          {vale.tipo !== "entrada" ? (
            <>
              <Campo rot={vale.tipo === "saida" ? "Retirado por" : "Devolvido por"} val={h?.colaborador_nome} />
              <Campo rot={`Destino (${destinoRot})`} val={h?.destino_nome} />
            </>
          ) : (
            <>
              <Campo rot="Fornecedor" val={h?.fornecedor_nome} />
              <Campo rot="Nota fiscal" val={vale.nota_fiscal} />
            </>
          )}
          {vale.observacao && <div className="col-span-2"><Campo rot="Observação" val={vale.observacao} /></div>}
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-2">Código</th>
              <th className="py-2 pr-2">Material</th>
              <th className="py-2 pr-2 text-right">Qtd</th>
              <th className="py-2 pr-2">Un</th>
              {gerencia && <th className="py-2 text-right print:hidden">Valor</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.item_id} className="border-b border-gray-100">
                <td className="py-2 pr-2 text-gray-500">{l.produto_codigo || "—"}</td>
                <td className="py-2 pr-2">{l.produto_nome}</td>
                <td className="py-2 pr-2 text-right font-medium tabular-nums">{qtdBR(l.quantidade)}</td>
                <td className="py-2 pr-2 text-gray-500">{l.unidade}</td>
                {gerencia && <td className="py-2 text-right tabular-nums text-gray-600 print:hidden">{formatCurrency(l.valor)}</td>}
              </tr>
            ))}
          </tbody>
          {gerencia && (
            <tfoot className="print:hidden">
              <tr><td colSpan={4} className="py-2 text-right text-xs text-gray-500">Total ({vale.tipo === "saida" ? "custo médio" : "valor de entrada"})</td>
                <td className="py-2 text-right font-semibold tabular-nums">{formatCurrency(total)}</td></tr>
            </tfoot>
          )}
        </table>

        {/* assinaturas (papel) */}
        <div className="mt-16 grid grid-cols-2 gap-10 text-center text-xs text-gray-600">
          <div>
            <div className="border-t border-gray-400 pt-1">{vale.tipo === "entrada" ? "Recebido por (almoxarifado)" : "Entregue por (almoxarifado)"}</div>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">
              {vale.tipo === "saida" ? `Recebido por — ${h?.colaborador_nome ?? ""}` : vale.tipo === "devolucao" ? `Devolvido por — ${h?.colaborador_nome ?? ""}` : "Conferido por"}
            </div>
          </div>
        </div>
        {vale.tipo === "saida" && (
          <p className="mt-6 text-[10px] text-gray-400">Declaro ter recebido o material acima, em bom estado, para uso no destino indicado.</p>
        )}
      </div>
    </div>
  );
}

function Campo({ rot, val }: { rot: string; val: any }) {
  return <div><p className="text-xs text-gray-400">{rot}</p><p className="font-medium text-gray-800">{val || "—"}</p></div>;
}
