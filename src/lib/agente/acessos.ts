// =============================================================================
// Pessoas da empresa com e-mail (perfis.email pode estar em branco em cadastros
// antigos → completa pelo auth). Usado na tela "Quem lança pelo chat".
// Roda com o cliente admin: o chamador JÁ conferiu que é o dono do agente.
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export type PessoaAcesso = { id: string; nome: string; email: string | null; papel: string | null };

export async function pessoasDaEmpresa(admin: SupabaseClient, empresaId: string): Promise<PessoaAcesso[]> {
  const { data } = await admin
    .from("perfis")
    .select("id,nome,email,papel")
    .eq("empresa_consultora_id", empresaId)
    .eq("ativo", true)
    .neq("papel", "agente")
    .order("nome");
  const pessoas = ((data ?? []) as PessoaAcesso[]).map((p) => ({ ...p }));
  if (pessoas.some((p) => !p.email)) {
    try {
      const { data: lu } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const m = new Map<string, string>();
      for (const u of lu?.users ?? []) if (u.email) m.set(u.id, u.email);
      for (const p of pessoas) if (!p.email) p.email = m.get(p.id) ?? null;
    } catch {
      /* segue com o que houver */
    }
  }
  return pessoas;
}

// Empresa em uso: o super em modo suporte usa empresa_ativa (igual ao RLS).
export function empresaEmUso(perfil: any): string | null {
  return (perfil?.papel === "super" && perfil?.empresa_ativa) ? perfil.empresa_ativa : perfil?.empresa_consultora_id ?? null;
}
