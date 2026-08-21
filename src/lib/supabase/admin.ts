import { createClient } from "@supabase/supabase-js";

// Cliente com service_role — SÓ pode ser usado no servidor (API routes/actions).
// Requer SUPABASE_SERVICE_ROLE_KEY no ambiente (nunca exposto ao browser).
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no ambiente.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
