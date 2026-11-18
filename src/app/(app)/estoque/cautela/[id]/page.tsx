import CautelaDocumento from "@/components/ferramentas/CautelaDocumento";

export default async function CautelaPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ novo?: string }> }) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  return <CautelaDocumento id={params.id} novo={searchParams.novo === "1"} />;
}
