/**
 * Recalcule en cascade les périodes closes d'une enveloppe ET de tous ses ancêtres à
 * partir d'une date donnée (le dépensé agrégé remonte tout l'arbre, donc un changement
 * sur une feuille peut affecter le grand livre de chacun de ses parents). Partagé entre
 * /api/sync/push (mutation en direct) et /api/cron/recurrences (occurrences générées en
 * rattrapage, potentiellement pour des dates déjà closes). Best-effort : n'interrompt
 * jamais l'appelant.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToEnvelope } from "./mappers";
import { getAncestors } from "@/lib/domain/envelopes";

export async function recalculatePeriodsForEnvelopeAndAncestors(
  supabase: SupabaseClient,
  userId: string,
  envelopeId: string | null | undefined,
  fromDate: string | undefined
): Promise<void> {
  if (!envelopeId || !fromDate) return;
  try {
    const { data: envelopeRows } = await supabase.from("envelopes").select("*").eq("user_id", userId);
    if (!envelopeRows) return;
    const envelopes = envelopeRows.map(rowToEnvelope);
    const target = envelopes.find((e) => e.id === envelopeId);
    if (!target) return;
    const chain = [target, ...getAncestors(target, envelopes)];
    for (const env of chain) {
      await supabase.rpc("recalculate_periods_from", {
        p_envelope_id: env.id,
        p_from_date: fromDate.slice(0, 10),
      });
    }
  } catch (err) {
    console.error("[periods] échec du recalcul en cascade", err);
  }
}
