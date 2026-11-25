import AtaDocumento from "@/components/gestao/AtaDocumento";

export default async function AtaImprimirPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <AtaDocumento id={id} />;
}
