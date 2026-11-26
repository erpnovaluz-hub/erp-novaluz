import ConciliacaoExtrato from "@/components/ConciliacaoExtrato";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// empresa em uso (super em modo suporte usa empresa_ativa, como o RLS) — é a
// 1ª pasta do caminho no bucket "anexos" para subir o PDF do extrato.
export default async function ConciliacaoPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("perfis").select("papel,empresa_ativa,empresa_consultora_id").eq("id", user.id).maybeSingle()
    : { data: null };
  const empresaId = (perfil?.papel === "super" && perfil?.empresa_ativa) ? perfil.empresa_ativa : perfil?.empresa_consultora_id ?? "";
  return <ConciliacaoExtrato empresaId={empresaId} />;
}
