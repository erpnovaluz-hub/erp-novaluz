import RelatorioExecucao from "@/components/os/RelatorioExecucao";

export default async function RelatorioExecucaoPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <RelatorioExecucao id={params.id} />;
}
