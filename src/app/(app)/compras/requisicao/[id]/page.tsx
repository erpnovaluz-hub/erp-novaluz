import RequisicaoCompraDocumento from "@/components/RequisicaoCompraDocumento";

export default function RequisicaoCompraDocPage({ params }: { params: { id: string } }) {
  return <RequisicaoCompraDocumento id={params.id} />;
}
