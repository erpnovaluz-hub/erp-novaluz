import AbrirEtiqueta from "@/components/ferramentas/AbrirEtiqueta";

export default function EtiquetaPage({ params }: { params: { codigo: string } }) {
  return <AbrirEtiqueta codigo={params.codigo} />;
}
