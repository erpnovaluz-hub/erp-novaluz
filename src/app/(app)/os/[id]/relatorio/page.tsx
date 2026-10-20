import RelatorioExecucao from "@/components/os/RelatorioExecucao";

export default function RelatorioExecucaoPage({ params }: { params: { id: string } }) {
  return <RelatorioExecucao id={params.id} />;
}
