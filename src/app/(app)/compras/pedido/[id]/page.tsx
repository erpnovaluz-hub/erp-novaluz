import PedidoCompraDocumento from "@/components/PedidoCompraDocumento";

export default async function PedidoCompraDocPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <PedidoCompraDocumento id={params.id} />;
}
