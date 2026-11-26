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

// Lista de e-mails de uma premissa ("a@x.com, b@y.com" → ["a@x.com","b@y.com"]).
export function listaEmails(valor: string | null | undefined): string[] {
  return String(valor || "").split(/[,;\s]+/).map((s) => s.toLowerCase().trim()).filter(Boolean);
}

// Lançador = e-mail na premissa agente_lancadores (0075): pode lançar no
// financeiro pelo chat (cartões de título/baixa) e confirmar os próprios cartões.
export function calcLancador(valor: string | null | undefined, email: string | null | undefined): boolean {
  const e = (email || "").toLowerCase();
  return !!e && listaEmails(valor).includes(e);
}

export async function ehLancadorDoAgente(sb: SupabaseClient, email: string | null | undefined): Promise<boolean> {
  const { data } = await sb.from("premissas_agente").select("valor").eq("chave", "agente_lancadores").limit(1).maybeSingle();
  return calcLancador((data as any)?.valor, email);
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
