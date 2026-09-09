import CotacaoCompraDocumento from "@/components/CotacaoCompraDocumento";

export default function CotacaoCompraDocPage({ params }: { params: { id: string } }) {
  return <CotacaoCompraDocumento id={params.id} />;
}
