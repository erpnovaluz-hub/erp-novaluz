import OSDocumento from "@/components/OSDocumento";

export default async function OSDocumentoPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <OSDocumento id={params.id} />;
}
