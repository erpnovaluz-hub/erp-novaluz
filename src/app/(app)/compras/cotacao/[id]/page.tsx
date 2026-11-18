import CotacaoCompraDocumento from "@/components/CotacaoCompraDocumento";

export default async function CotacaoCompraDocPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <CotacaoCompraDocumento id={params.id} />;
}
