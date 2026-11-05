import ValeDocumento from "@/components/estoque/ValeDocumento";

export default async function ValePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <ValeDocumento id={params.id} />;
}
