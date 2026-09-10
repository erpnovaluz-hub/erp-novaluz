// Resolve a empresa em uso no servidor: a ativa (modo suporte do super) tem
// prioridade sobre a empresa vinculada ao perfil. Usado no layout e no dashboard.
import { createClient } from "@/lib/supabase/server";

export type EmpresaAtiva = {
  id: string | null;
  nome: string;
  modoSuporte: boolean;
  isSuper: boolean;
};

export async function getEmpresaAtiva(): Promise<EmpresaAtiva> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, nome: "Sem empresa vinculada", modoSuporte: false, isSuper: false };

  const { data: perfil } = await supabase
    .from("perfis")
    .select("papel, empresa_consultora_id")
    .eq("id", user.id)
    .maybeSingle();

  const isSuper = (perfil as any)?.papel === "super";
  let nome = perfil ? "Sem empresa vinculada" : "⚠ Perfil não configurado";
  let modoSuporte = false;
  let empresaId = (perfil as any)?.empresa_consultora_id ?? null;

  if (perfil) {
    if (isSuper) {
      const { data: pa } = await supabase.from("perfis").select("empresa_ativa").eq("id", user.id).maybeSingle();
      if ((pa as any)?.empresa_ativa) { empresaId = (pa as any).empresa_ativa; modoSuporte = true; }
    }
    if (empresaId) {
      const { data: emp } = await supabase.from("empresas_consultoras").select("nome").eq("id", empresaId).maybeSingle();
      if (emp) nome = emp.nome;
    }
  }

  return { id: empresaId, nome, modoSuporte, isSuper };
}
