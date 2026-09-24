import InventarioView from "@/components/estoque/InventarioView";

export default function InventarioPage({ params }: { params: { id: string } }) {
  return <InventarioView id={params.id} />;
}
