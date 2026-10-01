/**
 * POST /api/sync/push
 *
 * Reçoit un lot d'événements du journal local (créés hors-ligne ou en ligne) et les
 * applique aux tables Postgres. Idempotent : un événement déjà connu (même id) n'est
 * jamais réappliqué, ce qui rend les nouvelles tentatives après coupure réseau sûres.
 * Chaque événement est traité indépendamment : un rejet (règle métier violée, ex. la
 * fratrie dépasserait le parent) n'empêche pas l'application des événements suivants
 * du lot.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { createServerClientFromBearerToken } from "@/lib/supabase/server";
import {
  envelopeToRow,
  incomeEntryToRow,
  incomeSourceToRow,
  journalEventToRow,
  partialToRow,
  recurrenceRuleToRow,
  transactionToRow,
  transferToRow,
} from "@/lib/supabase/mappers";
import { checkThresholdAndNotify } from "@/lib/notifications/threshold-check";
import { recalculatePeriodsForEnvelopeAndAncestors } from "@/lib/supabase/period-recalc";
import type { JournalEvent } from "@/types/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

interface PushResult {
  id: string;
  status: "applied" | "rejected";
  reason?: string;
}

export async function POST(req: NextRequest) {
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

  const body = (await req.json()) as { events: JournalEvent[] };
  const events = Array.isArray(body.events) ? body.events : [];
  const results: PushResult[] = [];

  for (const event of events) {
    const { data: existing } = await supabase
      .from("journal_events")
      .select("id, status, reject_reason")
      .eq("id", event.id)
      .maybeSingle();

    if (existing) {
      results.push({
        id: event.id,
        status: existing.status,
        reason: existing.reject_reason ?? undefined,
      });
      continue;
    }

    let status: "applied" | "rejected" = "applied";
    let reason: string | undefined;

    try {
      await applyEvent(supabase, user.id, event);
    } catch (err) {
      status = "rejected";
      reason = err instanceof Error ? err.message : "erreur inconnue";
    }

    const { error: insertError } = await supabase.from("journal_events").insert(
      journalEventToRow({ ...event, userId: user.id, status, rejectReason: reason ?? null })
    );
    if (insertError) {
      // Ne devrait arriver qu'en cas de conflit d'id concurrent : on considère
      // l'événement comme déjà traité par une requête parallèle.
      results.push({ id: event.id, status: "applied" });
      continue;
    }

    results.push({ id: event.id, status, reason });
  }

  return NextResponse.json({ results });
}

async function applyEvent(supabase: SupabaseClient, userId: string, event: JournalEvent): Promise<void> {
  const payload = event.payload as Record<string, unknown>;

  switch (event.eventType) {
    case "envelope.create": {
      const row = envelopeToRow({ ...(payload as any), userId });
      const { error } = await supabase.from("envelopes").upsert(row, { onConflict: "id" });
      if (error) throw new Error(error.message);
      return;
    }
    case "envelope.update": {
      const row = partialToRow("envelope", payload);
      const { error } = await supabase.from("envelopes").update(row).eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }
    case "envelope.archive": {
      const { error } = await supabase
        .from("envelopes")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }
    case "envelope.delete": {
      const { error } = await supabase.from("envelopes").delete().eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }

    case "transaction.create": {
      const row = transactionToRow({ ...(payload as any), userId });
      const { error } = await supabase.from("transactions").upsert(row, { onConflict: "id" });
      if (error) throw new Error(error.message);
      // Ne retarde jamais la réponse : exécuté après l'envoi de la réponse HTTP via
      // l'API `after` de Next.js (fiable en environnement serverless, contrairement à
      // un simple appel non attendu qui pourrait être interrompu). Effets secondaires
      // best-effort : alerte de seuil (uniquement si rattachée à une enveloppe -- une
      // dépense hors budget n'a pas de seuil) et recalcul en cascade au cas où la date
      // saisie tombe dans une période déjà close.
      const envelopeId = payload.envelopeId as string | null;
      if (envelopeId) {
        after(() =>
          checkThresholdAndNotify(supabase, userId, envelopeId, {
            amount: payload.amount as number,
            type: payload.type as "income" | "expense",
          })
        );
      }
      after(() =>
        recalculatePeriodsForEnvelopeAndAncestors(supabase, userId, envelopeId, payload.occurredAt as string)
      );
      return;
    }
    case "transaction.update": {
      const row = partialToRow("transaction", payload);
      const { error } = await supabase.from("transactions").update(row).eq("id", event.entityId);
      if (error) throw new Error(error.message);
      // La date et/ou l'enveloppe ont pu changer : on recalcule aussi bien l'ancienne
      // que la nouvelle enveloppe rattachée (voir inversePayload, capturé avant
      // modification), avec la date la plus ancienne des deux pour ne rien manquer.
      const newEnvelopeId = (payload.envelopeId as string | null | undefined) ?? undefined;
      const oldEnvelopeId = (event.inversePayload?.envelopeId as string | null | undefined) ?? undefined;
      const newDate = payload.occurredAt as string | undefined;
      const oldDate = event.inversePayload?.occurredAt as string | undefined;
      const earliestDate = [newDate, oldDate].filter(Boolean).sort()[0];
      after(() => recalculatePeriodsForEnvelopeAndAncestors(supabase, userId, newEnvelopeId, earliestDate));
      after(() => recalculatePeriodsForEnvelopeAndAncestors(supabase, userId, oldEnvelopeId, earliestDate));
      return;
    }
    case "transaction.delete": {
      const { data: current } = await supabase
        .from("transactions")
        .select("envelope_id, occurred_at")
        .eq("id", event.entityId)
        .maybeSingle();
      const { error } = await supabase
        .from("transactions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", event.entityId);
      if (error) throw new Error(error.message);
      after(() =>
        recalculatePeriodsForEnvelopeAndAncestors(supabase, userId, current?.envelope_id, current?.occurred_at)
      );
      return;
    }

    case "transfer.create": {
      // Ne modifie jamais allocated_amount (voir ARCHITECTURE.md) : son effet passe
      // uniquement par transfers_in/transfers_out de la période en cours des deux
      // enveloppes, recalculées à la volée à la lecture (ou en cascade ci-dessous si la
      // date tombe dans une période déjà close).
      const fromId = payload.fromEnvelopeId as string;
      const toId = payload.toEnvelopeId as string;
      const { error: transferErr } = await supabase.from("transfers").upsert(
        transferToRow({
          id: event.entityId,
          userId,
          fromEnvelopeId: fromId,
          toEnvelopeId: toId,
          amount: payload.amount as number,
          note: (payload.note as string) ?? null,
          occurredAt: (payload.occurredAt as string) ?? event.clientCreatedAt,
          createdAt: event.clientCreatedAt,
        }),
        { onConflict: "id" }
      );
      if (transferErr) throw new Error(transferErr.message);
      const occurredAt = (payload.occurredAt as string) ?? event.clientCreatedAt;
      after(() => recalculatePeriodsForEnvelopeAndAncestors(supabase, userId, fromId, occurredAt));
      after(() => recalculatePeriodsForEnvelopeAndAncestors(supabase, userId, toId, occurredAt));
      return;
    }

    case "recurrence.create": {
      const row = recurrenceRuleToRow({ ...(payload as any), userId });
      const { error } = await supabase.from("recurrence_rules").upsert(row, { onConflict: "id" });
      if (error) throw new Error(error.message);
      return;
    }
    case "recurrence.update": {
      const row = partialToRow("recurrence_rule", payload);
      const { error } = await supabase.from("recurrence_rules").update(row).eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }
    case "recurrence.delete": {
      const { error } = await supabase.from("recurrence_rules").delete().eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }

    case "pending_recurrence.confirm": {
      const tx = payload.transaction as Record<string, unknown>;
      const { error: txErr } = await supabase
        .from("transactions")
        .upsert(transactionToRow({ ...(tx as any), userId }), { onConflict: "id" });
      if (txErr) throw new Error(txErr.message);
      const { error: prErr } = await supabase
        .from("pending_recurrences")
        .update({ status: "confirmed", resolved_at: new Date().toISOString() })
        .eq("id", event.entityId);
      if (prErr) throw new Error(prErr.message);
      const txEnvelopeId = tx.envelopeId as string | null;
      if (txEnvelopeId) {
        after(() =>
          checkThresholdAndNotify(supabase, userId, txEnvelopeId, {
            amount: tx.amount as number,
            type: tx.type as "income" | "expense",
          })
        );
      }
      after(() =>
        recalculatePeriodsForEnvelopeAndAncestors(supabase, userId, txEnvelopeId, tx.occurredAt as string)
      );
      return;
    }
    case "pending_recurrence.dismiss": {
      const { error } = await supabase
        .from("pending_recurrences")
        .update({ status: "dismissed", resolved_at: new Date().toISOString() })
        .eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }

    case "profile.currency_change": {
      const rate = payload.rate as number;
      const toCurrency = payload.toCurrency as string;

      const { error: rpcError } = await supabase.rpc("apply_currency_conversion", {
        p_user_id: userId,
        p_rate: rate,
      });
      if (rpcError) throw new Error(rpcError.message);

      const { error: profErr } = await supabase
        .from("profiles")
        .update({ default_currency: toCurrency })
        .eq("id", userId);
      if (profErr) throw new Error(profErr.message);

      await supabase.from("exchange_rate_log").insert({
        user_id: userId,
        from_currency: payload.fromCurrency as string,
        to_currency: toCurrency,
        rate,
      });
      return;
    }
    case "profile.update": {
      const row = partialToRow("profile", payload);
      const { error } = await supabase.from("profiles").update(row).eq("id", userId);
      if (error) throw new Error(error.message);
      return;
    }

    case "income_source.create": {
      const row = incomeSourceToRow({ ...(payload as any), userId });
      const { error } = await supabase.from("income_sources").upsert(row, { onConflict: "id" });
      if (error) throw new Error(error.message);
      return;
    }
    case "income_source.update": {
      const row = partialToRow("income_source", payload);
      const { error } = await supabase.from("income_sources").update(row).eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }
    case "income_source.delete": {
      const { error } = await supabase.from("income_sources").delete().eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }

    case "income_entry.create": {
      const row = incomeEntryToRow({ ...(payload as any), userId });
      const { error } = await supabase.from("income_entries").upsert(row, { onConflict: "id" });
      if (error) throw new Error(error.message);
      return;
    }
    case "income_entry.update": {
      const row = partialToRow("income_entry", payload);
      const { error } = await supabase.from("income_entries").update(row).eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }
    case "income_entry.delete": {
      const { error } = await supabase
        .from("income_entries")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }

    default:
      throw new Error(`type d'événement non pris en charge côté serveur: ${event.eventType}`);
  }
}
