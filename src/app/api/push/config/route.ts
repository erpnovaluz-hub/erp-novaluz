import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Chave pública VAPID lida em tempo de execução (não depende do build) +
// diagnóstico de quais variáveis de ambiente faltam (só os NOMES, nunca valores).
export const dynamic = "force-dynamic";

// leitura por nome: "process.env.NEXT_PUBLIC_X" literal é substituído no build (ficaria vazio)
const env = (nome: string) => (process.env[nome] ?? "").trim();

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const publicKey = env("NEXT_PUBLIC_" + "VAPID_PUBLIC_KEY") || env("VAPID_PUBLIC_KEY");
  const faltando = [
    ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", publicKey],
    ["VAPID_PRIVATE_KEY", env("VAPID_PRIVATE_KEY")],
    ["PUSH_WEBHOOK_SECRET", env("PUSH_WEBHOOK_SECRET")],
    ["SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_ROLE_KEY")],
  ].filter(([, v]) => !v).map(([n]) => n);

  return NextResponse.json({ publicKey: publicKey || null, faltando, ambiente: env("VERCEL_ENV") || "local" });
}
