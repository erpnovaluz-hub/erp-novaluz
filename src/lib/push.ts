// =============================================================================
// Web Push — envio (SÓ no servidor: usa a chave privada VAPID).
// Envs: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// (VAPID_SUBJECT = https://seu-site ou mailto:contato — identifica o remetente
// para os serviços de push do Google/Apple/Mozilla).
// =============================================================================
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PushPayload = { title: string; body: string; url: string; tag?: string };

let configurado = false;
function configurar() {
  if (configurado) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("Chaves VAPID não configuradas (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://localhost", pub, priv);
  configurado = true;
}

// Manda para todos os aparelhos da pessoa; apaga inscrições que expiraram (404/410).
export async function enviarParaPerfil(admin: SupabaseClient, perfilId: string, payload: PushPayload) {
  configurar();
  const { data: subs } = await admin.from("push_inscricoes").select("id, endpoint, p256dh, auth").eq("perfil_id", perfilId);
  let enviados = 0;
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
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from("push_inscricoes").delete().eq("id", s.id);
    }
  }
  return { aparelhos: subs?.length ?? 0, enviados };
}
