/** POST /api/push/subscribe — enregistre l'abonnement Web Push de cet appareil (6). */

import { NextRequest, NextResponse } from "next/server";
import { createServerClientFromCookies } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createServerClientFromCookies();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { endpoint, p256dh, auth } = body as { endpoint?: string; p256dh?: string; auth?: string };
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }

  const deviceId = req.headers.get("x-device-id") ?? crypto.randomUUID();

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { user_id: user.id, device_id: deviceId, endpoint, p256dh, auth_key: auth },
      { onConflict: "endpoint" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
