import PropostaComposer from "@/components/PropostaComposer";

export default async function PropostaComposerPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <PropostaComposer id={params.id} />;
}
