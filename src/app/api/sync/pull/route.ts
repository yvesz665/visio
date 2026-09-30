/**
 * GET /api/sync/pull?since=<seq>
 *
 * Deux cas :
 *  - `since` vaut 0 (nouvel appareil, ou première synchronisation) : on renvoie un
 *    instantané COMPLET de toutes les données de l'utilisateur. C'est nécessaire car le
 *    budget général et les enveloppes initiales créées pendant l'onboarding, ainsi que
 *    tout ce qui existait déjà avant que cet appareil ne se connecte, ne correspondent à
 *    aucun événement que cet appareil aurait pu "rater" -- il n'a jamais rien eu.
 *  - `since` > 0 (appareil déjà initialisé) : on renvoie seulement les événements plus
 *    récents que le curseur local et l'état à jour des entités qu'ils concernent. Le
 *    client applique ces snapshots tels quels : le serveur fait autorité une fois les
 *    événements appliqués, ce qui évite d'avoir à rejouer des diffs côté client.
 *
 * Dans les deux cas, un lot borné (au plus PAGE_SIZE) d'événements est aussi renvoyé
 * pour alimenter le journal d'activité et l'annulation.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClientFromBearerToken } from "@/lib/supabase/server";
import {
  rowToEnvelope,
  rowToJournalEvent,
  rowToPendingRecurrence,
  rowToProfile,
  rowToRecurrenceRule,
  rowToTransaction,
  rowToTransfer,
} from "@/lib/supabase/mappers";
import type { JournalEntityType } from "@/types/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 500;

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

  const sinceParam = Number(req.nextUrl.searchParams.get("since") ?? "0");
  const since = Number.isFinite(sinceParam) ? sinceParam : 0;
  const isFullBootstrap = since <= 0;

  const { data: eventRows, error: eventsError } = await supabase
    .from("journal_events")
    .select("*")
    .eq("user_id", user.id)
    .gt("seq", since)
    .order("seq", { ascending: true })
    .limit(PAGE_SIZE);

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 });
  }

  const events = (eventRows ?? []).map(rowToJournalEvent);

  // Le curseur avance toujours jusqu'au plus grand seq réellement connu côté serveur
  // (pas seulement celui du lot renvoyé), sans quoi un compte avec plus d'événements
  // que PAGE_SIZE resterait bloqué à répéter la même page.
  const { data: maxSeqRow } = await supabase
    .from("journal_events")
    .select("seq")
    .eq("user_id", user.id)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestKnownSeq = maxSeqRow ? Number(maxSeqRow.seq) : since;
  const cursor =
    events.length === PAGE_SIZE
      ? Math.max(...events.map((e) => e.seq ?? 0)) // encore une page à récupérer ensuite
      : latestKnownSeq;

  const profilePromise = supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle()
    .then(({ data }) => (data ? rowToProfile(data) : undefined));

  if (isFullBootstrap) {
    const [envelopes, transactions, recurrenceRules, pendingRecurrences, transfers, profile] =
      await Promise.all([
        fetchAll(supabase, "envelopes", user.id, rowToEnvelope),
        fetchAll(supabase, "transactions", user.id, rowToTransaction),
        fetchAll(supabase, "recurrence_rules", user.id, rowToRecurrenceRule),
        fetchAll(supabase, "pending_recurrences", user.id, rowToPendingRecurrence),
        fetchAll(supabase, "transfers", user.id, rowToTransfer),
        profilePromise,
      ]);

    return NextResponse.json({
      events,
      cursor,
      snapshots: { envelopes, transactions, recurrenceRules, pendingRecurrences, transfers, profile },
      deletions: {},
    });
  }

  const idsByType: Record<JournalEntityType, Set<string>> = {
    envelope: new Set(),
    transaction: new Set(),
    transfer: new Set(),
    recurrence_rule: new Set(),
    pending_recurrence: new Set(),
    profile: new Set(),
  };
  for (const e of events) {
    idsByType[e.entityType].add(e.entityId);
  }

  const [
    envelopes,
    transactions,
    recurrenceRules,
    pendingRecurrencesFromEvents,
    transfers,
    profile,
    awaitingConfirmation,
  ] = await Promise.all([
    fetchByIds(supabase, "envelopes", idsByType.envelope, rowToEnvelope),
    fetchByIds(supabase, "transactions", idsByType.transaction, rowToTransaction),
    fetchByIds(supabase, "recurrence_rules", idsByType.recurrence_rule, rowToRecurrenceRule),
    fetchByIds(supabase, "pending_recurrences", idsByType.pending_recurrence, rowToPendingRecurrence),
    fetchByIds(supabase, "transfers", idsByType.transfer, rowToTransfer),
    profilePromise,
    // Les échéances en attente créées par le job planifié (/api/cron/recurrences) ne
    // sont rattachées à aucun événement de journal : on les récupère systématiquement,
    // comme le profil, pour qu'elles apparaissent sans délai sur tous les appareils.
    supabase
      .from("pending_recurrences")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "awaiting_confirmation")
      .then(({ data }) => (data ?? []).map(rowToPendingRecurrence)),
  ]);

  const pendingRecurrences = [
    ...pendingRecurrencesFromEvents,
    ...awaitingConfirmation.filter((p) => !pendingRecurrencesFromEvents.some((q) => q.id === p.id)),
  ];

  // Seules les enveloppes et les règles de récurrence peuvent être supprimées
  // définitivement (envelope.delete / recurrence.delete) : un id demandé mais absent
  // du résultat signale au client qu'il doit retirer cette entité localement.
  const deletedEnvelopeIds = Array.from(idsByType.envelope).filter(
    (id) => !envelopes.some((e) => e.id === id)
  );
  const deletedRecurrenceIds = Array.from(idsByType.recurrence_rule).filter(
    (id) => !recurrenceRules.some((r) => r.id === id)
  );

  return NextResponse.json({
    events,
    cursor,
    snapshots: { envelopes, transactions, recurrenceRules, pendingRecurrences, transfers, profile },
    deletions: { envelopes: deletedEnvelopeIds, recurrenceRules: deletedRecurrenceIds },
  });
}

async function fetchByIds<T>(
  supabase: SupabaseClient,
  table: string,
  ids: Set<string>,
  mapRow: (row: any) => T
): Promise<T[]> {
  if (ids.size === 0) return [];
  const { data, error } = await supabase.from(table).select("*").in("id", Array.from(ids));
  if (error) return [];
  return (data ?? []).map(mapRow);
}

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  userId: string,
  mapRow: (row: any) => T
): Promise<T[]> {
  const { data, error } = await supabase.from(table).select("*").eq("user_id", userId);
  if (error) return [];
  return (data ?? []).map(mapRow);
}
