/**
 * GET /api/cron/recurrences?secret=<CRON_SECRET>
 *
 * Job planifié (à appeler quotidiennement, ex. Vercel Cron ou tout scheduler externe)
 * qui déclenche les transactions récurrentes dues (4.2). Pour chaque règle active dont
 * `next_run_date` est atteinte :
 *  - budget suffisant (ou revenu) : la transaction est créée automatiquement, avec un
 *    événement de journal `transaction.create` pour qu'elle apparaisse dans l'activité
 *    de tous les appareils et reste annulable comme n'importe quelle transaction ;
 *  - budget insuffisant (dépense) : une entrée `pending_recurrences` est créée à la
 *    place, en attente de confirmation manuelle de l'utilisateur (jamais créée
 *    automatiquement dans ce cas), et une notification push est envoyée.
 *
 * S'exécute pour tous les utilisateurs (clé de service), en itérant tant que
 * `next_run_date` reste dans le passé, pour rattraper plusieurs échéances manquées.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { rowToEnvelope, rowToProfile, rowToRecurrenceRule, rowToTransaction } from "@/lib/supabase/mappers";
import { buildEnvelopeTree, findSummaryById } from "@/lib/domain/envelopes";
import { currentCycleEnd, currentCycleStart, isWithinCycle, computeNextRunDate, isDue } from "@/lib/domain/recurrence";
import { hasEnoughBudgetForAutoRecurrence } from "@/lib/domain/transactions";
import { sendPushToUser } from "@/lib/notifications/push-server";
import { checkThresholdAndNotify } from "@/lib/notifications/threshold-check";
import type { Transaction } from "@/types/domain";

const MAX_OCCURRENCES_PER_RULE = 12; // filet de sécurité si une règle n'a pas tourné depuis longtemps

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: dueRules, error } = await supabase
    .from("recurrence_rules")
    .select("*")
    .eq("status", "active")
    .lte("next_run_date", today);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ ruleId: string; action: string }> = [];

  for (const row of dueRules ?? []) {
    const rule = rowToRecurrenceRule(row);
    let cursor = rule.nextRunDate;
    let occurrences = 0;

    while (isDue(new Date(`${cursor}T00:00:00Z`), new Date()) && occurrences < MAX_OCCURRENCES_PER_RULE) {
      if (rule.endDate && cursor > rule.endDate) {
        await supabase.from("recurrence_rules").update({ status: "ended" }).eq("id", rule.id);
        break;
      }

      const action = await processOccurrence(supabase, rule.userId, rule.envelopeId, {
        ruleId: rule.id,
        amount: rule.amount,
        type: rule.type,
        description: rule.description,
        scheduledDate: cursor,
      });
      results.push({ ruleId: rule.id, action });

      cursor = computeNextRunDate(new Date(`${cursor}T00:00:00Z`), rule.intervalValue, rule.intervalUnit)
        .toISOString()
        .slice(0, 10);
      occurrences += 1;
    }

    await supabase.from("recurrence_rules").update({ next_run_date: cursor }).eq("id", rule.id);
  }

  return NextResponse.json({ processed: results.length, results });
}

async function processOccurrence(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  envelopeId: string,
  occurrence: {
    ruleId: string;
    amount: number;
    type: "income" | "expense";
    description: string | null;
    scheduledDate: string;
  }
): Promise<"created" | "pending"> {
  const [{ data: profileRow }, { data: envelopeRows }, { data: txRows }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("envelopes").select("*").eq("user_id", userId),
    supabase.from("transactions").select("*").eq("user_id", userId).is("deleted_at", null),
  ]);

  const hasBudget = (() => {
    if (occurrence.type === "income" || !profileRow || !envelopeRows) return true;
    const profile = rowToProfile(profileRow);
    const envelopes = envelopeRows.map(rowToEnvelope);
    const allTx = (txRows ?? []).map(rowToTransaction);
    const now = new Date();
    const cycleStart = currentCycleStart(now, profile.cycleAnchorDay);
    const cycleEnd = currentCycleEnd(now, profile.cycleAnchorDay);
    const txByEnvelope = new Map<string, Transaction[]>();
    for (const tx of allTx) {
      if (!isWithinCycle(new Date(tx.occurredAt), cycleStart, cycleEnd)) continue;
      const list = txByEnvelope.get(tx.envelopeId) ?? [];
      list.push(tx);
      txByEnvelope.set(tx.envelopeId, list);
    }
    const tree = buildEnvelopeTree(envelopes, txByEnvelope, profile.alertThresholdPct);
    if (!tree) return false;
    const summary = findSummaryById(tree, envelopeId);
    if (!summary) return false;
    const remainingDirect = summary.availableForDirect - summary.directSpent;
    return hasEnoughBudgetForAutoRecurrence(remainingDirect, occurrence.amount, occurrence.type);
  })();

  if (hasBudget) {
    const txId = crypto.randomUUID();
    const tx = {
      id: txId,
      user_id: userId,
      envelope_id: envelopeId,
      amount: occurrence.amount,
      type: occurrence.type,
      occurred_at: occurrence.scheduledDate,
      description: occurrence.description,
      recurrence_rule_id: occurrence.ruleId,
    };
    await supabase.from("transactions").insert(tx);
    await supabase.from("journal_events").insert({
      id: crypto.randomUUID(),
      user_id: userId,
      device_id: "server-cron",
      event_type: "transaction.create",
      entity_type: "transaction",
      entity_id: txId,
      payload: {
        id: txId,
        userId,
        envelopeId,
        amount: occurrence.amount,
        type: occurrence.type,
        occurredAt: occurrence.scheduledDate,
        description: occurrence.description,
        recurrenceRuleId: occurrence.ruleId,
      },
      client_created_at: new Date().toISOString(),
      status: "applied",
    });
    await checkThresholdAndNotify(supabase, userId, envelopeId, {
      amount: occurrence.amount,
      type: occurrence.type,
    });
    return "created";
  }

  await supabase.from("pending_recurrences").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    recurrence_rule_id: occurrence.ruleId,
    envelope_id: envelopeId,
    scheduled_date: occurrence.scheduledDate,
    amount: occurrence.amount,
    type: occurrence.type,
    description: occurrence.description,
    status: "awaiting_confirmation",
  });
  await sendPushToUser(supabase, userId, {
    title: "Confirmation nécessaire",
    body: "Une transaction récurrente n'a pas pu être créée automatiquement (budget insuffisant).",
    url: "/transactions?tab=pending",
    tag: `pending-${occurrence.ruleId}-${occurrence.scheduledDate}`,
  });
  return "pending";
}
