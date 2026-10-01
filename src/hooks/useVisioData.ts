"use client";

/**
 * Hooks de lecture réactive de la base locale (Dexie). Grâce à `useLiveQuery`, l'UI se
 * met à jour automatiquement dès qu'une mutation locale ou une synchronisation modifie
 * les données -- en ligne comme hors-ligne, puisque tout passe par IndexedDB (10.2).
 */

import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie";
import { buildEnvelopeTree } from "@/lib/domain/envelopes";
import { currentCycleEnd, currentCycleStart, isWithinCycle, todayInTimeZone } from "@/lib/domain/recurrence";
import { computeSoldeReel } from "@/lib/domain/periods";
import { getCarryInMap, getProvisionalEnvelopeIds } from "@/lib/db/repository";
import type { EnvelopeSummary, Profile } from "@/types/domain";
import { useAuth } from "./useAuth";

export function useProfile(): Profile | undefined {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return undefined;
    return getDb().profiles.get(user.id);
  }, [user?.id]);
}

/**
 * Arbre des enveloppes avec report, disponible et alertes pour le cycle en cours (7.1,
 * report de période). Chaque noeud résout sa propre fenêtre de cycle ; le report reçu
 * vient de la dernière période close connue localement (autoritaire une fois
 * synchronisée), le disponible en cours est toujours recalculé à la volée et marqué
 * "provisoire" tant que des mutations locales le concernant ne sont pas synchronisées.
 */
export function useEnvelopeTree(): EnvelopeSummary | null | undefined {
  const { user } = useAuth();
  const profile = useProfile();

  return useLiveQuery(async () => {
    if (!user || !profile) return undefined;
    const db = getDb();
    const [envelopes, transactions, transfers, carryInByEnvelope, provisionalEnvelopeIds] = await Promise.all([
      db.envelopes.where("userId").equals(user.id).toArray(),
      db.transactions.where("userId").equals(user.id).toArray(),
      db.transfers.where("userId").equals(user.id).toArray(),
      getCarryInMap(user.id),
      getProvisionalEnvelopeIds(user.id),
    ]);

    return buildEnvelopeTree({
      envelopes,
      transactions,
      transfers,
      carryInByEnvelope,
      globalCycleAnchorDay: profile.cycleAnchorDay,
      today: todayInTimeZone(new Date(), profile.timezone),
      defaultThresholdPct: profile.alertThresholdPct,
      provisionalEnvelopeIds,
    });
  }, [user?.id, profile?.cycleAnchorDay, profile?.alertThresholdPct, profile?.timezone]);
}

export function useAllEnvelopes() {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return [];
    return getDb().envelopes.where("userId").equals(user.id).toArray();
  }, [user?.id]);
}

export function useTransactions(limit = 200) {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return [];
    const all = await getDb()
      .transactions.where("userId")
      .equals(user.id)
      .filter((t) => !t.deletedAt)
      .toArray();
    return all.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  }, [user?.id, limit]);
}

export function usePendingRecurrences() {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return [];
    return getDb()
      .pendingRecurrences.where("userId")
      .equals(user.id)
      .filter((p) => p.status === "awaiting_confirmation")
      .toArray();
  }, [user?.id]);
}

export function useJournalEvents(limit = 100) {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return [];
    const all = await getDb().journalEvents.where("userId").equals(user.id).toArray();
    return all
      .filter((e) => e.status === "applied")
      .sort((a, b) => b.clientCreatedAt.localeCompare(a.clientCreatedAt))
      .slice(0, limit);
  }, [user?.id, limit]);
}

export function useRecurrenceRules() {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return [];
    return getDb().recurrenceRules.where("userId").equals(user.id).toArray();
  }, [user?.id]);
}

/** Pièce jointe (4.1) associée à une transaction, s'il en existe une. */
export function useAttachmentForTransaction(transactionId: string | undefined) {
  return useLiveQuery(async () => {
    if (!transactionId) return null;
    const found = await getDb().attachments.where("transactionId").equals(transactionId).first();
    return found ?? null;
  }, [transactionId]);
}

/** Table des ids de transaction ayant une pièce jointe, pour afficher un indicateur dans une liste. */
export function useTransactionIdsWithAttachment() {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return new Set<string>();
    const all = await getDb().attachments.where("userId").equals(user.id).toArray();
    return new Set(all.map((a) => a.transactionId));
  }, [user?.id]);
}

// ============================================================================
// RENTRÉES D'ARGENT ET SOLDE RÉEL
// ============================================================================

export function useIncomeSources() {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return [];
    return getDb().incomeSources.where("userId").equals(user.id).toArray();
  }, [user?.id]);
}

export function useIncomeEntries(limit = 500) {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return [];
    const all = await getDb()
      .incomeEntries.where("userId")
      .equals(user.id)
      .filter((e) => !e.deletedAt)
      .toArray();
    return all.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
  }, [user?.id, limit]);
}

export interface SoldeReel {
  /** Solde réel sur le cycle budgétaire en cours (7.1-like, "période sélectionnée"). */
  period: number;
  /** Solde réel cumulé depuis le début (toutes périodes confondues). */
  cumulative: number;
}

/**
 * solde réel = rentrées - (dépenses confirmées - remboursements), y compris les
 * dépenses/remboursements hors budget (section "Dépenses hors budget").
 */
export function useSoldeReel(): SoldeReel | undefined {
  const { user } = useAuth();
  const profile = useProfile();

  return useLiveQuery(async () => {
    if (!user || !profile) return undefined;
    const db = getDb();
    const [incomeEntries, transactions] = await Promise.all([
      db.incomeEntries.where("userId").equals(user.id).filter((e) => !e.deletedAt).toArray(),
      db.transactions.where("userId").equals(user.id).filter((t) => !t.deletedAt).toArray(),
    ]);

    const today = todayInTimeZone(new Date(), profile.timezone);
    const cycleStart = currentCycleStart(today, profile.cycleAnchorDay);
    const cycleEnd = currentCycleEnd(today, profile.cycleAnchorDay);

    function soldeFor(withinPeriodOnly: boolean): number {
      let incomeEntriesTotal = 0;
      let expenseTotal = 0;
      let reimbursementTotal = 0;
      for (const inc of incomeEntries) {
        if (withinPeriodOnly && !isWithinCycle(new Date(`${inc.occurredAt}T00:00:00Z`), cycleStart, cycleEnd)) {
          continue;
        }
        incomeEntriesTotal += inc.amount;
      }
      for (const t of transactions) {
        if (withinPeriodOnly && !isWithinCycle(new Date(`${t.occurredAt}T00:00:00Z`), cycleStart, cycleEnd)) {
          continue;
        }
        if (t.type === "expense") expenseTotal += t.amount;
        else reimbursementTotal += t.amount;
      }
      return computeSoldeReel({ incomeEntriesTotal, expenseTotal, reimbursementTotal });
    }

    return { period: soldeFor(true), cumulative: soldeFor(false) };
  }, [user?.id, profile?.cycleAnchorDay, profile?.timezone]);
}

/** Grand livre des périodes closes d'une enveloppe (report d'une période à l'autre). */
export function useEnvelopePeriods(envelopeId: string | undefined) {
  return useLiveQuery(async () => {
    if (!envelopeId) return [];
    const all = await getDb().envelopePeriods.where("envelopeId").equals(envelopeId).toArray();
    return all.sort((a, b) => b.cycleStart.localeCompare(a.cycleStart));
  }, [envelopeId]);
}
