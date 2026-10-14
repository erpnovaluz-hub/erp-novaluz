// =============================================================================
// Web Push — envio (SÓ no servidor: usa a chave privada VAPID).
// Envs: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// VAPID_SUBJECT identifica o remetente para os serviços de push. A Apple (iPhone)
// RECUSA (403 BadJwtToken) subject inválido, "localhost" ou de exemplo — nesses
// casos usamos a URL real do site, que chega em `origem`.
// =============================================================================
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PushPayload = { title: string; body: string; url: string; tag?: string };
export type FalhaPush = { aparelho: string; status: number | null; motivo: string };

function subjectValido(s: string) {
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(s)) return true;
  if (!/^https:\/\//i.test(s)) return false;
  return !/localhost|seu-app|seu-site|exemplo|example/i.test(s);
}

function configurar(origem?: string) {
  // por nome: "process.env.NEXT_PUBLIC_X" literal é fixado no build
  const pub = (process.env["NEXT_PUBLIC_" + "VAPID_PUBLIC_KEY"] || process.env["VAPID_PUBLIC_KEY"] || "").trim();
  const priv = (process.env["VAPID_PRIVATE_KEY"] || "").trim();
  if (!pub || !priv) throw new Error("Chaves VAPID não configuradas (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
  const env = (process.env["VAPID_SUBJECT"] || "").trim();
  const subject = subjectValido(env) ? env
    : origem && /^https:\/\//i.test(origem) && !/localhost/i.test(origem) ? origem
    : "https://erp-novaluz.vercel.app";
  webpush.setVapidDetails(subject, pub, priv);
}

function nomeAparelho(endpoint: string, ua: string | null) {
  if (/push\.apple\.com/.test(endpoint)) return "iPhone/iPad";
  if (/android/i.test(ua ?? "")) return "Android";
  if (/fcm\.googleapis|google/.test(endpoint)) return "Chrome";
  if (/mozilla/.test(endpoint)) return "Firefox";
  if (/windows|notify\.windows/.test(endpoint)) return "Edge/Windows";
  return "aparelho";
}

// Manda para todos os aparelhos da pessoa; apaga inscrições que expiraram (404/410).
export async function enviarParaPerfil(admin: SupabaseClient, perfilId: string, payload: PushPayload, origem?: string) {
  configurar(origem);
  const { data: subs } = await admin.from("push_inscricoes").select("id, endpoint, p256dh, auth, aparelho").eq("perfil_id", perfilId);
  let enviados = 0;
  const falhas: FalhaPush[] = [];
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24, urgency: "high" },
      );
      enviados++;
      await admin.from("push_inscricoes").update({ ultimo_envio: new Date().toISOString() }).eq("id", s.id);
    } catch (e: any) {
      const status = e?.statusCode ?? null;
      falhas.push({ aparelho: nomeAparelho(s.endpoint, s.aparelho), status, motivo: String(e?.body || e?.message || e).slice(0, 160) });
      if (status === 404 || status === 410) await admin.from("push_inscricoes").delete().eq("id", s.id);
    }
  }
  return { aparelhos: subs?.length ?? 0, enviados, falhas };
}
