import OSDocumento from "@/components/OSDocumento";

export default function OSDocumentoPage({ params }: { params: { id: string } }) {
  return <OSDocumento id={params.id} />;
}
