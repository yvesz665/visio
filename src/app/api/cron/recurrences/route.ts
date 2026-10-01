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
import { rowToEnvelope, rowToProfile, rowToRecurrenceRule, rowToTransaction, rowToTransfer } from "@/lib/supabase/mappers";
import { buildEnvelopeTree, findSummaryById } from "@/lib/domain/envelopes";
import { computeNextRunDate, isDue, todayInTimeZone } from "@/lib/domain/recurrence";
import { hasEnoughBudgetForAutoRecurrence } from "@/lib/domain/transactions";
import { sendPushToUser } from "@/lib/notifications/push-server";
import { checkThresholdAndNotify } from "@/lib/notifications/threshold-check";
import { recalculatePeriodsForEnvelopeAndAncestors } from "@/lib/supabase/period-recalc";

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

  // Clôture quotidienne de toutes les périodes échues, tous utilisateurs (en plus du
  // rattrapage paresseux déclenché à chaque /api/sync/pull) : idempotente, un échec ici
  // ne fausse jamais un report déjà calculé, elle ne fait que compléter ce qui manque.
  const { error: closeError } = await supabase.rpc("close_all_due_periods", { p_user_id: null });
  if (closeError) {
    console.error("[cron] échec de la clôture des périodes", closeError.message);
  }

  return NextResponse.json({ processed: results.length, results });
}

async function processOccurrence(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  envelopeId: string | null,
  occurrence: {
    ruleId: string;
    amount: number;
    type: "income" | "expense";
    description: string | null;
    scheduledDate: string;
  }
): Promise<"created" | "pending"> {
  const hasBudget = await (async () => {
    // Hors budget = pas de plafond à vérifier, comme une saisie manuelle hors budget.
    if (!envelopeId || occurrence.type === "income") return true;

    const [{ data: profileRow }, { data: envelopeRows }, { data: txRows }, { data: transferRows }, { data: periodRows }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("envelopes").select("*").eq("user_id", userId),
        supabase.from("transactions").select("*").eq("user_id", userId).is("deleted_at", null),
        supabase.from("transfers").select("*").eq("user_id", userId),
        supabase.from("envelope_periods").select("*").eq("user_id", userId),
      ]);
    if (!profileRow || !envelopeRows) return true;

    const profile = rowToProfile(profileRow);
    const envelopes = envelopeRows.map(rowToEnvelope);
    const transactions = (txRows ?? []).map(rowToTransaction);
    const transfers = (transferRows ?? []).map(rowToTransfer);

    const carryInByEnvelope = new Map<string, number>();
    const latestCycleEndByEnvelope = new Map<string, string>();
    for (const row of periodRows ?? []) {
      const eid = row.envelope_id as string;
      const cycleEnd = row.cycle_end as string;
      if (!latestCycleEndByEnvelope.has(eid) || cycleEnd > latestCycleEndByEnvelope.get(eid)!) {
        latestCycleEndByEnvelope.set(eid, cycleEnd);
        carryInByEnvelope.set(eid, Number(row.carry_out));
      }
    }

    const tree = buildEnvelopeTree({
      envelopes,
      transactions,
      transfers,
      carryInByEnvelope,
      globalCycleAnchorDay: profile.cycleAnchorDay,
      today: todayInTimeZone(new Date(), profile.timezone),
      defaultThresholdPct: profile.alertThresholdPct,
    });
    if (!tree) return false;
    const summary = findSummaryById(tree, envelopeId);
    if (!summary) return false;
    // Le disponible (report + transferts déjà inclus) fait foi, pas seulement
    // l'allocation directe : une enveloppe en report positif peut couvrir une
    // dépense même si son allocation nominale seule ne suffirait pas.
    return hasEnoughBudgetForAutoRecurrence(summary.remaining, occurrence.amount, occurrence.type);
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
    if (envelopeId) {
      await checkThresholdAndNotify(supabase, userId, envelopeId, {
        amount: occurrence.amount,
        type: occurrence.type,
      });
    }
    // L'échéance peut concerner une date passée (rattrapage) qui tombe dans une
    // période déjà close : on recalcule pour ne jamais fausser le report.
    await recalculatePeriodsForEnvelopeAndAncestors(supabase, userId, envelopeId, occurrence.scheduledDate);
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
