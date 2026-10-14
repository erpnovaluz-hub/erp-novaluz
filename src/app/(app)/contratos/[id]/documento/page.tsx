import ContratoDocumento from "@/components/ContratoDocumento";

export default async function ContratoDocumentoPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <ContratoDocumento id={params.id} />;
}
