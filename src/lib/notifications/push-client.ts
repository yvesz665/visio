"use client";

/** Abonnement aux notifications push côté navigateur (section 6). */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function isPushSupported(): Promise<boolean> {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function subscribeToPush(authHeaders: Record<string, string>): Promise<boolean> {
  if (!(await isPushSupported())) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY manquant : notifications désactivées.");
    return false;
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // Cast nécessaire : lib.dom type désormais Uint8Array génériquement sur
    // ArrayBufferLike, plus étroit que le BufferSource attendu ici, alors que le
    // comportement runtime est correct (buffer ArrayBuffer classique, non partagé).
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
  });

  const json = subscription.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    }),
  });
  return res.ok;
}

export async function getPushPermissionState(): Promise<NotificationPermission | "unsupported"> {
  if (!(await isPushSupported())) return "unsupported";
  return Notification.permission;
}
