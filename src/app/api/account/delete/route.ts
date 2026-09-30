/**
 * POST /api/account/delete
 *
 * Suppression de compte définitive et immédiate (9.4), sans période de rétention.
 * Authentifie d'abord l'appelant via son propre jeton (jamais un id fourni par le
 * client), puis utilise la clé de service (seule habilitée à supprimer un utilisateur
 * Supabase Auth) pour supprimer le compte. Toutes les lignes applicatives (enveloppes,
 * transactions, journal, etc.) sont liées à auth.users avec ON DELETE CASCADE : elles
 * disparaissent automatiquement avec le compte.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClientFromBearerToken, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userClient = createServerClientFromBearerToken(token);
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
