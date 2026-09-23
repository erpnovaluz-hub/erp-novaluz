import ProjetoView from "@/components/tarefas/ProjetoView";

export default function ProjetoPage({ params }: { params: { id: string } }) {
  return <ProjetoView projetoId={params.id} />;
}
