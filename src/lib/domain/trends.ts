/**
 * Agrégats pour l'onglet "Historique et tendances" du tableau de bord (7.2) :
 * évolution revenus/dépenses par cycle, et comparaison budget alloué / dépenses réelles.
 */

import type { Envelope, Transaction } from "@/types/domain";
import { currentCycleEnd, currentCycleStart, isWithinCycle } from "./recurrence";

export interface CycleBucket {
  label: string; // ex: "25 juil. – 25 août"
  cycleStart: string; // ISO
  cycleEnd: string; // ISO
  income: number;
  expense: number;
  allocated: number; // montant alloué au budget général sur ce cycle (valeur actuelle, cf. limite ci-dessous)
}

const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/**
 * Construit les `count` derniers cycles budgétaires (le plus ancien en premier), avec
 * les totaux de revenus/dépenses de chacun. Le montant "alloué" utilise le montant actuel
 * du budget général : Visio ne conserve pas d'historique des montants alloués passés,
 * donc cette comparaison reflète "si j'avais eu ce budget sur les cycles précédents".
 */
export function computeCycleBuckets(
  transactions: Transaction[],
  rootEnvelope: Envelope | undefined,
  cycleAnchorDay: number,
  count: number,
  referenceDate: Date = new Date()
): CycleBucket[] {
  const buckets: CycleBucket[] = [];
  let cursor = referenceDate;

  for (let i = 0; i < count; i++) {
    const start = currentCycleStart(cursor, cycleAnchorDay);
    const end = currentCycleEnd(cursor, cycleAnchorDay);

    let income = 0;
    let expense = 0;
    for (const tx of transactions) {
      if (tx.deletedAt) continue;
      const occurred = new Date(tx.occurredAt);
      if (!isWithinCycle(occurred, start, end)) continue;
      if (tx.type === "income") income += tx.amount;
      else expense += tx.amount;
    }

    buckets.push({
      label: `${MONTH_LABEL.format(start)} – ${MONTH_LABEL.format(end)}`,
      cycleStart: start.toISOString(),
      cycleEnd: end.toISOString(),
      income,
      expense,
      allocated: rootEnvelope?.allocatedAmount ?? 0,
    });

    // recule d'un jour avant le début du cycle courant pour atterrir dans le cycle précédent
    cursor = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  }

  return buckets.reverse();
}
