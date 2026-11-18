import RequisicaoCompraDocumento from "@/components/RequisicaoCompraDocumento";

export default async function RequisicaoCompraDocPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <RequisicaoCompraDocumento id={params.id} />;
}
