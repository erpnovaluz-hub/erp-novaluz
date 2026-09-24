import ValeDocumento from "@/components/estoque/ValeDocumento";

export default function ValePage({ params }: { params: { id: string } }) {
  return <ValeDocumento id={params.id} />;
}
