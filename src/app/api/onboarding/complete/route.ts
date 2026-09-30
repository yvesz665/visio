/**
 * POST /api/onboarding/complete
 *
 * Étape unique, nécessairement en ligne (l'inscription Supabase Auth qui la précède
 * l'est déjà), qui crée le profil et le budget général initial (9.2). Une fois cette
 * étape faite, toute l'utilisation quotidienne de l'app (saisie, consultation) devient
 * possible hors-ligne via IndexedDB + synchronisation différée (10.2).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClientFromCookies } from "@/lib/supabase/server";
import { envelopeToRow, profileToRow, rowToEnvelope, rowToProfile } from "@/lib/supabase/mappers";
import type { Envelope, Profile } from "@/types/domain";

interface OnboardingBody {
  currency: string;
  cycleAnchorDay: number;
  alertThresholdPct: number;
  rootEnvelope: { id: string; name: string; color: string; icon: string; allocatedAmount: number };
  initialEnvelopes: Array<{
    id: string;
    name: string;
    color: string;
    icon: string;
    allocatedAmount: number;
  }>;
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClientFromCookies();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Idempotence : un utilisateur ne peut avoir qu'un seul budget général (contrainte
  // "envelopes_one_root_per_user" en base). Si l'onboarding a déjà été effectué
  // (double soumission, nouvel appareil renvoyé ici par erreur, etc.), on renvoie
  // l'état déjà existant au lieu de tenter une seconde création qui violerait cette
  // contrainte.
  const { data: existingRoot } = await supabase
    .from("envelopes")
    .select("*")
    .eq("user_id", user.id)
    .is("parent_id", null)
    .maybeSingle();

  if (existingRoot) {
    const [{ data: existingProfileRow }, { data: existingEnvelopeRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("envelopes").select("*").eq("user_id", user.id),
    ]);
    return NextResponse.json({
      profile: existingProfileRow ? rowToProfile(existingProfileRow) : null,
      envelopes: (existingEnvelopeRows ?? []).map(rowToEnvelope),
      alreadyOnboarded: true,
    });
  }

  const body = (await req.json()) as OnboardingBody;
  const now = new Date().toISOString();

  const profile: Profile = {
    id: user.id,
    email: user.email ?? "",
    displayName: null,
    defaultCurrency: body.currency,
    cycleAnchorDay: body.cycleAnchorDay,
    alertThresholdPct: body.alertThresholdPct,
    onboardingCompleted: true,
    createdAt: now,
    updatedAt: now,
  };

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(profileToRow(profile), { onConflict: "id" });
  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const root: Envelope = {
    id: body.rootEnvelope.id,
    userId: user.id,
    parentId: null,
    name: body.rootEnvelope.name,
    color: body.rootEnvelope.color,
    icon: body.rootEnvelope.icon,
    allocatedAmount: body.rootEnvelope.allocatedAmount,
    isRecurring: true,
    cycleMode: "inherit",
    cycleAnchorDay: null,
    alertThresholdPct: null,
    status: "active",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  const { error: rootError } = await supabase.from("envelopes").upsert(envelopeToRow(root), {
    onConflict: "id",
  });
  if (rootError) {
    return NextResponse.json({ error: rootError.message }, { status: 400 });
  }

  const createdEnvelopes: Envelope[] = [root];

  for (const [index, input] of body.initialEnvelopes.entries()) {
    const envelope: Envelope = {
      id: input.id,
      userId: user.id,
      parentId: root.id,
      name: input.name,
      color: input.color,
      icon: input.icon,
      allocatedAmount: input.allocatedAmount,
      isRecurring: true,
      cycleMode: "inherit",
      cycleAnchorDay: null,
      alertThresholdPct: null,
      status: "active",
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    const { error } = await supabase.from("envelopes").upsert(envelopeToRow(envelope), {
      onConflict: "id",
    });
    if (error) {
      // La règle d'allocation (trigger Postgres) peut rejeter une enveloppe si la
      // somme dépasse le budget général : on rapporte l'erreur telle quelle.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    createdEnvelopes.push(envelope);
  }

  return NextResponse.json({ profile, envelopes: createdEnvelopes });
}
