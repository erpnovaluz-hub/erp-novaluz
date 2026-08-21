"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { EMISSORA } from "@/lib/empresa";
import DocHeader from "@/components/DocHeader";
import PrintButton from "@/components/PrintButton";

type Row = Record<string, any>;

export default function ContratoDocumento({ id }: { id: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [ctr, setCtr] = useState<Row | null>(null);
  const [cliente, setCliente] = useState<Row | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const c = await supabase.from("contratos").select("*").eq("id", id).maybeSingle();
      setCtr(c.data);
      if (c.data?.cliente_id) setCliente((await supabase.from("clientes").select("*").eq("id", c.data.cliente_id).maybeSingle()).data);
      setCarregando(false);
    })();
  }, [supabase, id]);

  if (carregando) return <p className="text-gray-400">Carregando…</p>;
  if (!ctr) return <p className="text-gray-400">Contrato não encontrado. <Link href="/contratos" className="text-brand-600">voltar</Link></p>;

  let nc = 0;
  const num = () => `CLÁUSULA ${["PRIMEIRA","SEGUNDA","TERCEIRA","QUARTA"][nc++] ?? nc}ª`;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/contratos/${id}`} className="text-sm text-gray-500 hover:text-gray-800">← voltar à edição</Link>
        <PrintButton />
      </div>

      <div className="doc rounded-xl bg-white p-8 text-gray-800 shadow-sm print:p-0 print:shadow-none">
        <DocHeader titulo="CONTRATO DE PRESTAÇÃO DE SERVIÇOS" numero={ctr.numero || "—"} />

        {/* Partes */}
        <div className="mt-4 space-y-2 text-sm leading-relaxed text-gray-700">
          <p><b>CONTRATADA:</b> {EMISSORA.nome}, inscrita no CNPJ {EMISSORA.cnpj}, com sede em {EMISSORA.endereco}.</p>
          <p><b>CONTRATANTE:</b> {cliente?.nome ?? "—"}{cliente?.cnpj ? `, inscrita no CNPJ ${cliente.cnpj}` : ""}{cliente?.endereco ? `, com endereço em ${cliente.endereco}` : ""}.</p>
          <p>As partes acima qualificadas têm entre si, justo e contratado, o presente instrumento, que se regerá pelas cláusulas seguintes.</p>
        </div>

        {/* Objeto */}
        <Clausula titulo={`${num()} – DO OBJETO`}>
          {ctr.objeto || "Prestação de serviços conforme proposta e escopo acordados entre as partes."}
        </Clausula>

        {ctr.escopo_desc && (
          <Clausula titulo={`${num()} – DO ESCOPO DOS SERVIÇOS`}>{ctr.escopo_desc}</Clausula>
        )}

        {/* Valor e pagamento */}
        <Clausula titulo={`${num()} – DO VALOR E DA FORMA DE PAGAMENTO`}>
          O valor total do presente contrato é de <b>{formatCurrency(ctr.valor)}</b>{ctr.condicoes ? `. Condições de pagamento: ${ctr.condicoes}.` : "."}
        </Clausula>

        {/* Prazo */}
        <Clausula titulo={`${num()} – DO PRAZO`}>
          O contrato vigora a partir de {formatDate(ctr.data_inicio)}{ctr.data_fim ? ` até ${formatDate(ctr.data_fim)}` : ", pelo prazo necessário à conclusão dos serviços"}.
          {ctr.tipo === "recorrente" ? " Trata-se de contrato de natureza recorrente." : ""}
        </Clausula>

        {/* Cláusulas adicionais */}
        {ctr.clausulas && (
          <div className="mt-6 whitespace-pre-line text-sm leading-relaxed text-gray-700">{ctr.clausulas}</div>
        )}

        {/* Assinaturas */}
        <p className="mt-8 text-sm text-gray-600">E, por estarem assim justas e contratadas, firmam o presente instrumento.</p>
        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div className="border-t border-gray-400 pt-2 text-center">
            <p className="font-medium">{EMISSORA.nome}</p>
            <p className="text-xs text-gray-500">CONTRATADA · CNPJ {EMISSORA.cnpj}</p>
          </div>
          <div className="border-t border-gray-400 pt-2 text-center">
            <p className="font-medium">{cliente?.nome ?? "Contratante"}</p>
            <p className="text-xs text-gray-500">CONTRATANTE{cliente?.cnpj ? ` · CNPJ ${cliente.cnpj}` : ""}</p>
          </div>
        </div>

        <div className="mt-8 border-t pt-3 text-center text-xs text-gray-400">
          {EMISSORA.nome} · CNPJ {EMISSORA.cnpj} · Contrato Nº {ctr.numero || "—"} · {EMISSORA.sistema}
        </div>
      </div>
    </div>
  );
}

function Clausula({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-1 text-sm font-bold text-brand-700">{titulo}</h3>
      <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">{children}</p>
    </div>
  );
}
