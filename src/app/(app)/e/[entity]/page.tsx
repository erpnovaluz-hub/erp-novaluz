import { notFound } from "next/navigation";
import { getEntity } from "@/lib/entities";
import EntityView from "@/components/EntityView";

export default function EntityPage({ params }: { params: { entity: string } }) {
  const entity = getEntity(params.entity);
  if (!entity) notFound();
  return <EntityView entityKey={params.entity} />;
}
