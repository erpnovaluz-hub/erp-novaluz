import FerramentaDetalhe from "@/components/ferramentas/FerramentaDetalhe";

export default async function FerramentaPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <FerramentaDetalhe id={params.id} />;
}
