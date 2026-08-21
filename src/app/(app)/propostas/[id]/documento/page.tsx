import PropostaDocumento from "@/components/PropostaDocumento";

export default function PropostaDocumentoPage({ params }: { params: { id: string } }) {
  return <PropostaDocumento id={params.id} />;
}
