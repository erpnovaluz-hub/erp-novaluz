import ContratoComposer from "@/components/ContratoComposer";

export default async function ContratoPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <ContratoComposer id={params.id} />;
}
