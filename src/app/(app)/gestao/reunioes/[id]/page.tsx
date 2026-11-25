import ReuniaoView from "@/components/gestao/ReuniaoView";

export default async function ReuniaoPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <ReuniaoView id={id} />;
}
