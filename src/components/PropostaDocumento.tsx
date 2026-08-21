"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { EMISSORA, FOTOS_PORTFOLIO } from "@/lib/empresa";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;

export default function PropostaDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [prop, setProp] = useState<Row | null>(null);
  const [itens, setItens] = useState<Row[]>([]);
  const [cliente, setCliente] = useState<Row | null>(null);
  const [contato, setContato] = useState<Row | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const p = await supabase.from("propostas").select("*").eq("id", id).maybeSingle();
      const it = await supabase.from("itens_proposta").select("*").eq("proposta_id", id).order("ordem");
      setProp(p.data); setItens(it.data ?? []);
      if (p.data?.cliente_id) {
        const c = await supabase.from("clientes").select("*").eq("id", p.data.cliente_id).maybeSingle();
        setCliente(c.data);
        const ct = await supabase.from("contatos").select("*").eq("cliente_id", p.data.cliente_id).limit(1).maybeSingle();
        setContato(ct.data);
      }
      setCarregando(false);
    })();
  }, [supabase, id]);

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!prop) return <p className="text-gray-400">Proposta não encontrada. <Link href="/propostas" className="text-brand-600">voltar</Link></p>;

  const apres = prop.apresentacao || `Prezado(a) ${cliente?.nome ?? ""}, agradecemos a oportunidade de apresentar esta proposta técnica e comercial para o seu projeto.`;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/propostas/${id}`} className="text-sm text-gray-500 hover:text-gray-800">← voltar à edição</Link>
        <PrintButton />
      </div>

      <div className="doc rounded-xl bg-white text-gray-800 shadow-sm print:shadow-none">
        {/* ===================== PÁGINA 1 ===================== */}
        <div className="p-8 print:p-0">
          {/* Cabeçalho (limpo, com faixa da marca embaixo) */}
          <div className="flex items-start justify-between border-b-2 border-brand-600 pb-4">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={EMISSORA.logo} alt="logo" className="mb-2 h-12 object-contain" />
              <p className="text-xs text-gray-500">{EMISSORA.nome} · CNPJ {EMISSORA.cnpj}</p>
              <p className="text-xs text-gray-500">{EMISSORA.endereco} · Tel {EMISSORA.telefone}</p>
            </div>
            <div className="text-right">
              <h1 className="text-lg font-bold text-brand-700">PROPOSTA TÉCNICA E COMERCIAL</h1>
              <p className="text-sm text-gray-500">Nº {prop.numero || "—"}</p>
              <p className="mt-1 text-xs text-gray-400">Solução técnica para seu projeto</p>
            </div>
          </div>

          {/* Destinatário */}
          <div className="mt-4 rounded-lg border border-gray-200 p-3 text-sm">
            <p className="mb-1 text-[11px] font-semibold uppercase text-gray-400">Destinatário</p>
            <p className="font-medium text-gray-800">{cliente?.nome ?? "—"}</p>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
              {cliente?.cnpj && <span>CNPJ/CPF: {cliente.cnpj}</span>}
              {(cliente?.telefone || contato?.telefone) && <span>Tel: {cliente?.telefone || contato?.telefone}</span>}
              {(cliente?.email || contato?.email) && <span>{cliente?.email || contato?.email}</span>}
              {contato?.nome && <span>A/C: {contato.nome}</span>}
            </div>
            {cliente?.endereco && <p className="mt-0.5 text-xs text-gray-500">{cliente.endereco}</p>}
          </div>

          {/* Resumo */}
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-gray-50 p-4 text-sm">
            <Campo rot="Emissão" val={formatDate(prop.data)} />
            <Campo rot="Válido até" val={formatDate(prop.validade)} />
            <Campo rot="Valor total" val={formatCurrency(prop.valor_total)} destaque />
          </div>

          {/* Apresentação breve */}
          <Secao titulo="Apresentação">
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{apres}</p>
          </Secao>

          {/* Escopo e preços — serviços */}
          <Secao n="1." titulo="Escopo do fornecimento e preços">
            <table className="min-w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-gray-500">
                <tr><th className="py-2 pr-2">Foto</th><th className="py-2 pr-2">Descrição</th><th className="py-2 pr-2 text-right">Qtd</th><th className="py-2 pr-2 text-right">Vlr unit.</th><th className="py-2 text-right">Vlr total</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itens.length === 0 ? (
                  <tr><td colSpan={5} className="py-4 text-center text-gray-400">Sem itens.</td></tr>
                ) : itens.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2 pr-2">
                      {it.foto ? /* eslint-disable-next-line @next/next/no-img-element */ (
                        <img src={it.foto} alt="" className="h-14 w-20 rounded object-cover" />
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2 pr-2">
                      <p>{it.descricao}</p>
                      {it.referencia && <p className="text-xs text-gray-400">Ref. {it.referencia}</p>}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{Number(it.quantidade)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatCurrency(it.valor_unit)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatCurrency(it.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-brand-600 font-semibold">
                <tr><td colSpan={4} className="py-2 pr-2 text-right">VALOR TOTAL</td><td className="py-2 text-right text-brand-700">{formatCurrency(prop.valor_total)}</td></tr>
              </tfoot>
            </table>
          </Secao>
        </div>

        {/* ===================== PÁGINA 2 (detalhes técnicos) ===================== */}
        <div className="page-break p-8 print:p-0">
          <h2 className="mb-4 border-b-2 border-brand-600 pb-2 text-base font-bold text-brand-700">Detalhes técnicos e condições</h2>

          {/* Portfólio */}
          <Secao titulo="Nossa atuação">
            <div className="grid grid-cols-3 gap-2">
              {FOTOS_PORTFOLIO.map((f) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={f.arquivo} src={f.arquivo} alt={f.titulo} className="h-24 w-full rounded object-cover" />
              ))}
            </div>
          </Secao>

          {/* Premissas */}
          {prop.premissas && (
            <Secao n="2." titulo="Premissas e critérios técnicos">
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{prop.premissas}</p>
            </Secao>
          )}

          {/* Escopo descritivo */}
          {prop.escopo_desc && (
            <Secao titulo="Escopo detalhado">
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{prop.escopo_desc}</p>
            </Secao>
          )}

          {/* Condições comerciais */}
          <Secao n="3." titulo="Condições comerciais">
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Campo rot="Prazo de entrega" val={prop.prazo_entrega} />
              <Campo rot="Pagamento" val={prop.pagamento} />
              <Campo rot="Entrega / frete" val={prop.entrega_frete} />
              <Campo rot="Impostos" val={prop.impostos} />
              <Campo rot="Válido até" val={formatDate(prop.validade)} />
            </div>
          </Secao>

          {/* Assinatura */}
          <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
            <div className="border-t border-gray-400 pt-2 text-center">
              <p className="font-medium">{EMISSORA.nome}</p>
              <p className="text-xs text-gray-500">Contratada / Emissora · CNPJ {EMISSORA.cnpj}</p>
            </div>
            <div className="border-t border-gray-400 pt-2 text-center">
              <p className="font-medium">{cliente?.nome ?? "Contratante"}</p>
              <p className="text-xs text-gray-500">Contratante</p>
            </div>
          </div>

          <div className="mt-8 border-t pt-3 text-center text-xs text-gray-400">
            {EMISSORA.nome} · CNPJ {EMISSORA.cnpj} · {EMISSORA.endereco} · Tel {EMISSORA.telefone}<br />
            Proposta Nº {prop.numero || "—"} · {EMISSORA.sistema}
          </div>
        </div>
      </div>
    </div>
  );
}

function Secao({ n, titulo, children }: { n?: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">{n ? `${n} ` : ""}{titulo}</h3>
      {children}
    </section>
  );
}
function Campo({ rot, val, destaque }: { rot: string; val: any; destaque?: boolean }) {
  return <div><p className="text-[11px] uppercase text-gray-400">{rot}</p><p className={destaque ? "text-base font-bold text-brand-700" : "font-medium text-gray-800"}>{val || "—"}</p></div>;
}
