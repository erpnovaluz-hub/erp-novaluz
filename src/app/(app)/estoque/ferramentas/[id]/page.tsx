import FerramentaDetalhe from "@/components/ferramentas/FerramentaDetalhe";

export default function FerramentaPage({ params }: { params: { id: string } }) {
  return <FerramentaDetalhe id={params.id} />;
}
