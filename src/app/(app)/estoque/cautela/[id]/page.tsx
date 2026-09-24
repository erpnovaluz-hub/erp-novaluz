import CautelaDocumento from "@/components/ferramentas/CautelaDocumento";

export default function CautelaPage({ params, searchParams }: { params: { id: string }; searchParams: { novo?: string } }) {
  return <CautelaDocumento id={params.id} novo={searchParams.novo === "1"} />;
}
