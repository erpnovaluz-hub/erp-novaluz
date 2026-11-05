import { notFound } from "next/navigation";
import { getEntity } from "@/lib/entities";
import EntityView from "@/components/EntityView";

export default async function EntityPage(props: { params: Promise<{ entity: string }> }) {
  const params = await props.params;
  const entity = getEntity(params.entity);
  if (!entity) notFound();
  return <EntityView entityKey={params.entity} />;
}
