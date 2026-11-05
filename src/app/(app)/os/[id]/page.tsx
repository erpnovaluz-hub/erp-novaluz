import OSDetail from "@/components/OSDetail";

export default async function OSDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <OSDetail osId={params.id} />;
}
