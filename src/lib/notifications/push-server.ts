/**
 * Envoi de notifications Web Push (VAPID), utilisé côté serveur uniquement (route de
 * synchronisation et job planifié des récurrences). Nécessite NEXT_PUBLIC_VAPID_PUBLIC_KEY
 * / VAPID_PRIVATE_KEY / VAPID_SUBJECT (voir .env.example, générés via `npm run
 * generate-vapid-keys`).
 */

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    console.warn("[push] clés VAPID manquantes : notifications désactivées côté serveur.");
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export async function sendPushToUser(
  supabase: SupabaseClient,
  userId: string,
  payload: PushPayload
): Promise<void> {
  if (!ensureConfigured()) return;

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId);
  if (!subs || subs.length === 0) return;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          JSON.stringify(payload)
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Abonnement expiré ou révoqué côté navigateur : on le retire.
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("[push] envoi échoué", err);
        }
      }
    })
  );
}
