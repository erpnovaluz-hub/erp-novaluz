import { createClient } from "@/lib/supabase/server";
import { isGerencia, montarAcesso, type Acesso } from "@/lib/permissoes";

// Acesso do usuário logado (server components / rotas de API).
export async function carregarAcesso(): Promise<Acesso & { perfil: Record<string, any> | null }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ...montarAcesso(null), perfil: null };

  // select * : tolera banco ainda sem a coluna ativo (0040)
  const { data: perfil } = await supabase.from("perfis").select("*").eq("id", user.id).maybeSingle();
  const papel = perfil && (perfil as any).ativo !== false ? ((perfil as any).papel as string) : null;

  let overrides: { modulo: string; nivel: string }[] = [];
  if (papel && !isGerencia(papel)) {
    const { data } = await supabase.from("permissoes_papel").select("modulo, nivel").eq("papel", papel);
    overrides = data ?? [];
  }
  return { ...montarAcesso(papel, overrides), perfil: perfil as any };
}
