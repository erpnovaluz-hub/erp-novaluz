import FilaAprovacao from "@/components/agente/FilaAprovacao";
import { createClient } from "@/lib/supabase/server";
import { ehDonoDoAgente } from "@/lib/agente/donos";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data: perfil } = await sb.from("perfis").select("papel").eq("id", user?.id ?? "").maybeSingle();
  const dono = await ehDonoDoAgente(sb, user?.email, perfil?.papel);
  if (!dono) return <div className="p-6 text-sm text-gray-500">Área restrita ao administrador do assistente.</div>;

  const { data: acoes } = await sb
    .from("acoes_agente")
    .select("id,ferramenta,faixa,justificativa,parametros,criado_em")
    .eq("status", "pendente")
    .order("criado_em", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl px-3 py-4">
      <h1 className="mb-1 text-lg font-semibold">🗂️ Fila de aprovação</h1>
      <p className="mb-4 text-xs text-gray-500">Ações propostas pelo assistente e pelas rondas, aguardando sua decisão.</p>
      <FilaAprovacao inicial={acoes ?? []} />
    </div>
  );
}
