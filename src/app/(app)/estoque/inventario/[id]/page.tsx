import InventarioView from "@/components/estoque/InventarioView";

export default async function InventarioPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <InventarioView id={params.id} />;
}
