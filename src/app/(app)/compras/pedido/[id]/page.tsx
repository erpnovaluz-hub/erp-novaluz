import PedidoCompraDocumento from "@/components/PedidoCompraDocumento";

export default function PedidoCompraDocPage({ params }: { params: { id: string } }) {
  return <PedidoCompraDocumento id={params.id} />;
}
