import ProjetoView from "@/components/tarefas/ProjetoView";

export default async function ProjetoPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <ProjetoView projetoId={params.id} />;
}
