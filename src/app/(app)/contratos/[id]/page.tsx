import ContratoComposer from "@/components/ContratoComposer";

export default function ContratoPage({ params }: { params: { id: string } }) {
  return <ContratoComposer id={params.id} />;
}
