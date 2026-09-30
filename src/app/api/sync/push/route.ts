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
  journalEventToRow,
  partialToRow,
  recurrenceRuleToRow,
  transactionToRow,
  transferToRow,
} from "@/lib/supabase/mappers";
import { checkThresholdAndNotify } from "@/lib/notifications/threshold-check";
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
      // un simple appel non attendu qui pourrait être interrompu). Effet secondaire
      // best-effort, voir threshold-check.ts.
      after(() =>
        checkThresholdAndNotify(supabase, userId, payload.envelopeId as string, {
          amount: payload.amount as number,
          type: payload.type as "income" | "expense",
        })
      );
      return;
    }
    case "transaction.update": {
      const row = partialToRow("transaction", payload);
      const { error } = await supabase.from("transactions").update(row).eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }
    case "transaction.delete": {
      const { error } = await supabase
        .from("transactions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", event.entityId);
      if (error) throw new Error(error.message);
      return;
    }

    case "transfer.create": {
      const fromId = payload.fromEnvelopeId as string;
      const toId = payload.toEnvelopeId as string;
      const amount = payload.amount as number;

      const { data: fromRow, error: fromErr } = await supabase
        .from("envelopes")
        .select("allocated_amount")
        .eq("id", fromId)
        .single();
      if (fromErr || !fromRow) throw new Error(fromErr?.message ?? "enveloppe source introuvable");
      const { data: toRow, error: toErr } = await supabase
        .from("envelopes")
        .select("allocated_amount")
        .eq("id", toId)
        .single();
      if (toErr || !toRow) throw new Error(toErr?.message ?? "enveloppe destination introuvable");

      const { error: updFromErr } = await supabase
        .from("envelopes")
        .update({ allocated_amount: Number(fromRow.allocated_amount) - amount })
        .eq("id", fromId);
      if (updFromErr) throw new Error(updFromErr.message);

      const { error: updToErr } = await supabase
        .from("envelopes")
        .update({ allocated_amount: Number(toRow.allocated_amount) + amount })
        .eq("id", toId);
      if (updToErr) throw new Error(updToErr.message);

      const { error: transferErr } = await supabase.from("transfers").upsert(
        transferToRow({
          id: event.entityId,
          userId,
          fromEnvelopeId: fromId,
          toEnvelopeId: toId,
          amount,
          note: (payload.note as string) ?? null,
          occurredAt: event.clientCreatedAt,
          createdAt: event.clientCreatedAt,
        }),
        { onConflict: "id" }
      );
      if (transferErr) throw new Error(transferErr.message);
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
      after(() =>
        checkThresholdAndNotify(supabase, userId, tx.envelopeId as string, {
          amount: tx.amount as number,
          type: tx.type as "income" | "expense",
        })
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

    default:
      throw new Error(`type d'événement non pris en charge côté serveur: ${event.eventType}`);
  }
}
