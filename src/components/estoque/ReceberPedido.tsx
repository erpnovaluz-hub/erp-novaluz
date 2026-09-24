"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAcesso } from "@/components/AcessoProvider";
import { numeroBR } from "@/lib/planilha";
import { qtdBR } from "@/lib/almox";

type Item = { id: string; produto_id: string; quantidade: number; quantidade_recebida: number };

const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Conferência do recebimento: o que chegou de cada item, NF, foto da NF e divergências.
// Cada recebimento dá entrada no estoque e gera 1 título a pagar com o valor recebido.
export default function ReceberPedido({ ped, itens, prodNome, prodUn, onRecebido }: {
  ped: Record<string, any>; itens: Item[]; prodNome: Record<string, string>; prodUn: Record<string, string>;
  onRecebido: (msg: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { gerencia, empresaId } = useAcesso();
  const [depositos, setDepositos] = useState<{ id: string; nome: string }[]>([]);
  const [deposito, setDeposito] = useState<string>(ped.deposito_id ?? "");
  const [data, setData] = useState(hojeISO());
  const [nf, setNf] = useState("");
  const [venc, setVenc] = useState<string>(ped.vencimento ?? "");
  const [obs, setObs] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [div, setDiv] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const inputArq = useRef<HTMLInputElement>(null);

  const pendentes = itens.filter((it) => Number(it.quantidade) > Number(it.quantidade_recebida));

  useEffect(() => {
    supabase.from("depositos").select("id, nome").eq("ativo", true).order("nome").then(({ data: d }) => {
      setDepositos(d ?? []);
      setDeposito((atual) => atual || d?.[0]?.id || "");
    });
  }, [supabase]);

  // começa sugerindo "chegou tudo que falta"; o almoxarife corrige o que veio diferente
  useEffect(() => {
    setQtd(Object.fromEntries(pendentes.map((it) => [it.id, String(Number(it.quantidade) - Number(it.quantidade_recebida)).replace(".", ",")])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens]);

  const receber = pendentes.map((it) => ({ it, q: numeroBR(qtd[it.id]) ?? 0, pend: Number(it.quantidade) - Number(it.quantidade_recebida) }));
  const aceitos = receber.filter((x) => x.q > 0);
  const excede = receber.filter((x) => x.q > x.pend || Number.isNaN(x.q) || x.q < 0);
  const faltando = receber.filter((x) => x.q < x.pend && !div[x.it.id]?.trim());
  const ok = deposito && aceitos.length > 0 && excede.length === 0;

  async function confirmar() {
    if (!ok) return;
    const parcial = receber.some((x) => x.q < x.pend);
    if (parcial && !window.confirm("Recebimento parcial: o que não chegou continua pendente no pedido. Confirmar?")) return;
    setGravando(true); setErro(null);
    let anexo_caminho: string | null = null;
    if (arquivo) {
      const limpo = arquivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");
      anexo_caminho = `${empresaId}/recebimentos/${ped.id}/${crypto.randomUUID()}-${limpo}`;
      const up = await supabase.storage.from("anexos").upload(anexo_caminho, arquivo, { contentType: arquivo.type || undefined });
      if (up.error) { setGravando(false); setErro(`Foto da NF: ${up.error.message}`); return; }
    }
    const { data: r, error } = await supabase.rpc("receber_pedido", { p: {
      pedido_id: ped.id, deposito_id: deposito, data, nota_fiscal: nf, observacao: obs,
      anexo_caminho, anexo_nome: arquivo?.name ?? null, vencimento: gerencia ? venc || null : null,
      itens: aceitos.map(({ it, q }) => ({ item_id: it.id, quantidade: q, divergencia: div[it.id] ?? null })),
    } });
    setGravando(false);
    if (error) {
      if (anexo_caminho) await supabase.storage.from("anexos").remove([anexo_caminho]);
      setErro(error.message); return;
    }
    setNf(""); setObs(""); setArquivo(null); setDiv({});
    const st = (r as any)?.status === "recebido" ? "Pedido totalmente recebido." : "Recebimento parcial registrado; o restante segue pendente.";
    onRecebido(`✓ ${(r as any)?.numero ?? "Recebimento"} registrado. Estoque atualizado. ${st}`);
  }

  if (pendentes.length === 0) return null;

  return (
    <div className="no-print mb-4 rounded-xl border border-green-200 bg-green-50/60 p-4">
      <p className="mb-3 text-sm font-semibold text-green-900">📥 Receber material (conferência)</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="lbl">Depósito *</span>
          <select className="inp" value={deposito} onChange={(e) => setDeposito(e.target.value)}>
            <option value="">—</option>
            {depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="lbl">Data do recebimento</span>
          <input type="date" className="inp" value={data} onChange={(e) => setData(e.target.value)} />
        </label>
        <label className="block"><span className="lbl">Nota fiscal nº</span>
          <input className="inp" value={nf} onChange={(e) => setNf(e.target.value)} placeholder="ex.: 12345" />
        </label>
        {gerencia && (
          <label className="block"><span className="lbl">Vencimento do título</span>
            <input type="date" className="inp" value={venc} onChange={(e) => setVenc(e.target.value)} />
          </label>
        )}
        <div className="sm:col-span-2">
          <span className="lbl">Foto / PDF da nota fiscal</span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost bg-white text-sm ring-1 ring-gray-200" onClick={() => inputArq.current?.click()}>📷 {arquivo ? "Trocar arquivo" : "Tirar foto / anexar"}</button>
            {arquivo && <span className="truncate text-xs text-gray-600">{arquivo.name}</span>}
            <input ref={inputArq} type="file" accept="image/*,application/pdf" className="hidden"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-gray-500">
            <tr><th className="py-1.5">Material</th><th className="py-1.5 text-right">Pedido</th><th className="py-1.5 text-right">Já recebido</th><th className="py-1.5 text-right">Chegou agora</th><th className="py-1.5 pl-3">Divergência / obs.</th></tr>
          </thead>
          <tbody className="divide-y divide-green-100">
            {receber.map(({ it, q, pend }) => (
              <tr key={it.id}>
                <td className="py-1.5 pr-2">{prodNome[it.produto_id] ?? "—"} <span className="text-xs text-gray-400">{prodUn[it.produto_id]}</span></td>
                <td className="py-1.5 text-right tabular-nums">{qtdBR(it.quantidade)}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{qtdBR(it.quantidade_recebida)}</td>
                <td className="py-1.5 text-right">
                  <input inputMode="decimal" className={`inp w-20 py-1 text-right ${q > pend ? "border-red-400 text-red-700" : q < pend ? "border-amber-400" : ""}`}
                    value={qtd[it.id] ?? ""} onChange={(e) => setQtd((m) => ({ ...m, [it.id]: e.target.value }))} />
                </td>
                <td className="py-1.5 pl-3">
                  <input className="inp min-w-[150px] py-1 text-xs" placeholder={q < pend ? "por que veio menos?" : "avaria, lote, etc. (opcional)"}
                    value={div[it.id] ?? ""} onChange={(e) => setDiv((m) => ({ ...m, [it.id]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <input className="inp mt-3" placeholder="Observação do recebimento (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
      {excede.length > 0 && <p className="mt-2 text-xs text-red-600">Quantidade maior que o pendente em {excede.length} item(ns). Sobra de fornecedor entra como entrada avulsa no Balcão.</p>}
      {faltando.length > 0 && <p className="mt-2 text-xs text-amber-700">{faltando.length} item(ns) chegando a menos — anote o motivo na divergência.</p>}
      {erro && <p className="mt-2 text-sm text-red-600">{erro}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!ok || gravando} onClick={confirmar}>
          {gravando ? "Registrando…" : `Confirmar recebimento (${aceitos.length} item(ns))`}
        </button>
        <span className="text-xs text-gray-500">Dá entrada no estoque e gera o título a pagar do que chegou.</span>
      </div>
    </div>
  );
}
