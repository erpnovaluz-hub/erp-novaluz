import OSDetail from "@/components/OSDetail";

export default function OSDetailPage({ params }: { params: { id: string } }) {
  return <OSDetail osId={params.id} />;
}
