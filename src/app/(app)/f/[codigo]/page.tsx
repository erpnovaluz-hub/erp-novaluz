import AbrirEtiqueta from "@/components/ferramentas/AbrirEtiqueta";

export default async function EtiquetaPage(props: { params: Promise<{ codigo: string }> }) {
  const params = await props.params;
  return <AbrirEtiqueta codigo={params.codigo} />;
}
