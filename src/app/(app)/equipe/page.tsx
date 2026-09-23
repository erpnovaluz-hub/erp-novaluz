import EquipeAcessos from "@/components/EquipeAcessos";
import { getEmpresaAtiva } from "@/lib/empresaAtiva";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Rota restrita à gerência (AcessoProvider + RLS de perfis/permissoes_papel).
export default async function EquipePage() {
  const empresa = await getEmpresaAtiva();
  const { data: { user } } = await createClient().auth.getUser();
  return <EquipeAcessos empresaId={empresa.id} empresaNome={empresa.nome} meuId={user?.id ?? ""} />;
}
