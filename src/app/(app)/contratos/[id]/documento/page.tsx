import ContratoDocumento from "@/components/ContratoDocumento";

export default function ContratoDocumentoPage({ params }: { params: { id: string } }) {
  return <ContratoDocumento id={params.id} />;
}
