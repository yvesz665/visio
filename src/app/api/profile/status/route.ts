/**
 * GET /api/profile/status
 *
 * Réponse directe et sans ambiguïté à "cet utilisateur a-t-il déjà terminé
 * l'onboarding ?". Remplace une détection fragile basée sur "la synchronisation
 * en tâche de fond a-t-elle rapatrié un profil en local" : cette dernière pouvait
 * échouer silencieusement (réseau, session en cours de rafraîchissement...) et
 * renvoyer à tort un compte déjà configuré vers l'assistant d'accueil, avec le
 * risque de recréer un second budget général et de violer la contrainte
 * d'unicité (voir le correctif sur /api/onboarding/complete).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClientFromBearerToken } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerClientFromBearerToken(token);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({ onboardingCompleted: profile?.onboarding_completed ?? false });
}
