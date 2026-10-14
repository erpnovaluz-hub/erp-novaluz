import PropostaDocumento from "@/components/PropostaDocumento";

export default async function PropostaDocumentoPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <PropostaDocumento id={params.id} />;
}
