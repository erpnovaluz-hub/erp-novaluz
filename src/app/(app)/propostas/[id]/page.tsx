import PropostaComposer from "@/components/PropostaComposer";

export default function PropostaComposerPage({ params }: { params: { id: string } }) {
  return <PropostaComposer id={params.id} />;
}
