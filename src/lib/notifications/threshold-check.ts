/**
 * Détection de franchissement de seuil suite à une transaction (6), côté serveur (pour
 * que la notification parte même si l'app est fermée, tant que l'appareil finit par
 * synchroniser). Réutilise les fonctions pures de src/lib/domain pour rester cohérent
 * avec les calculs affichés dans le tableau de bord.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToEnvelope, rowToProfile, rowToTransaction, rowToTransfer } from "@/lib/supabase/mappers";
import { buildEnvelopeTree, getAncestors, findSummaryById } from "@/lib/domain/envelopes";
import { todayInTimeZone } from "@/lib/domain/recurrence";
import { detectNotificationTrigger } from "@/lib/domain/transactions";
import { sendPushToUser } from "./push-server";
import type { Transaction } from "@/types/domain";

export async function checkThresholdAndNotify(
  supabase: SupabaseClient,
  userId: string,
  affectedEnvelopeId: string,
  justInsertedTransaction: Pick<Transaction, "amount" | "type">
): Promise<void> {
  try {
    const [{ data: profileRow }, { data: envelopeRows }, { data: txRows }, { data: transferRows }, { data: periodRows }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("envelopes").select("*").eq("user_id", userId),
        supabase.from("transactions").select("*").eq("user_id", userId).is("deleted_at", null),
        supabase.from("transfers").select("*").eq("user_id", userId),
        supabase.from("envelope_periods").select("*").eq("user_id", userId),
      ]);
    if (!profileRow || !envelopeRows) return;

    const profile = rowToProfile(profileRow);
    const envelopes = envelopeRows.map(rowToEnvelope);
    const transactions = (txRows ?? []).map(rowToTransaction);
    const transfers = (transferRows ?? []).map(rowToTransfer);

    const carryInByEnvelope = new Map<string, number>();
    const latestCycleEndByEnvelope = new Map<string, string>();
    for (const row of periodRows ?? []) {
      const envelopeId = row.envelope_id as string;
      const cycleEnd = row.cycle_end as string;
      if (!latestCycleEndByEnvelope.has(envelopeId) || cycleEnd > latestCycleEndByEnvelope.get(envelopeId)!) {
        latestCycleEndByEnvelope.set(envelopeId, cycleEnd);
        carryInByEnvelope.set(envelopeId, Number(row.carry_out));
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
    if (!tree) return;

    const affectedEnvelope = envelopes.find((e) => e.id === affectedEnvelopeId);
    if (!affectedEnvelope) return;

    const delta =
      justInsertedTransaction.type === "expense"
        ? justInsertedTransaction.amount
        : -justInsertedTransaction.amount;

    const chain = [affectedEnvelope, ...getAncestors(affectedEnvelope, envelopes)];

    for (const node of chain) {
      const summary = findSummaryById(tree, node.id);
      if (!summary || summary.envelope.allocatedAmount <= 0) continue;

      const percentAfter = summary.percentConsumed;
      const percentBefore = ((summary.subtreeSpent - delta) / summary.envelope.allocatedAmount) * 100;
      const threshold = summary.envelope.alertThresholdPct ?? profile.alertThresholdPct;

      const trigger = detectNotificationTrigger(percentBefore, percentAfter, threshold);
      if (!trigger) continue;

      await sendPushToUser(supabase, userId, {
        title: trigger === "overbudget" ? "Budget dépassé" : "Seuil d'alerte atteint",
        body:
          trigger === "overbudget"
            ? `« ${summary.envelope.name} » a atteint ou dépassé son budget alloué.`
            : `« ${summary.envelope.name} » approche de son plafond (${Math.round(percentAfter)} %).`,
        url: `/envelopes/${summary.envelope.id}`,
        tag: `threshold-${summary.envelope.id}`,
      });
    }
  } catch (err) {
    // Une notification manquée ne doit jamais faire échouer la synchronisation elle-même.
    console.error("[notifications] échec de la vérification de seuil", err);
  }
}
