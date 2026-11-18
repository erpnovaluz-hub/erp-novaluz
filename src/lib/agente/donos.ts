// =============================================================================
// Dono do agente = login autorizado às "determinações" (executar ações no chat
// e aprovar a fila). Lista de e-mails na premissa agente_donos; sem lista, o
// fallback é o papel 'super'. A trava real é no servidor (rotas), não no menu.
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export function calcDono(
  donosValor: string | null | undefined,
  email: string | null | undefined,
  papel: string | null | undefined,
): boolean {
  const donos = String(donosValor || "").split(/[,;\s]+/).map((s: string) => s.toLowerCase().trim()).filter(Boolean);
  const e = (email || "").toLowerCase();
  return donos.length ? donos.includes(e) : papel === "super";
}

// Versão que lê a premissa (para quando o chamador ainda não a tem).
export async function ehDonoDoAgente(
  sb: SupabaseClient,
  email: string | null | undefined,
  papel: string | null | undefined,
): Promise<boolean> {
  const { data } = await sb.from("premissas_agente").select("valor").eq("chave", "agente_donos").limit(1).maybeSingle();
  return calcDono((data as any)?.valor, email, papel);
}
