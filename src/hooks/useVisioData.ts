"use client";

/**
 * Hooks de lecture réactive de la base locale (Dexie). Grâce à `useLiveQuery`, l'UI se
 * met à jour automatiquement dès qu'une mutation locale ou une synchronisation modifie
 * les données -- en ligne comme hors-ligne, puisque tout passe par IndexedDB (10.2).
 */

import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie";
import { buildEnvelopeTree } from "@/lib/domain/envelopes";
import { currentCycleStart, currentCycleEnd, isWithinCycle } from "@/lib/domain/recurrence";
import type { EnvelopeSummary, Profile } from "@/types/domain";
import { useAuth } from "./useAuth";

export function useProfile(): Profile | undefined {
  const { user } = useAuth();
  return useLiveQuery(async () => {
    if (!user) return undefined;
    return getDb().profiles.get(user.id);
  }, [user?.id]);
}

/** Arbre des enveloppes avec montants consommés/restants pour le cycle budgétaire en cours (7.1). */
export function useEnvelopeTree(): EnvelopeSummary | null | undefined {
  const { user } = useAuth();
  const profile = useProfile();

  return useLiveQuery(async () => {
    if (!user || !profile) return undefined;
    const db = getDb();
    const envelopes = await db.envelopes.where("userId").equals(user.id).toArray();
    const allTx = await db.transactions.where("userId").equals(user.id).toArray();

    const now = new Date();
    const cycleStart = currentCycleStart(now, profile.cycleAnchorDay);
    const cycleEnd = currentCycleEnd(now, profile.cycleAnchorDay);

    const txByEnvelope = new Map<string, typeof allTx>();
    for (const tx of allTx) {
      if (tx.deletedAt) continue;
      if (!isWithinCycle(new Date(tx.occurredAt), cycleStart, cycleEnd)) continue;
      const list = txByEnvelope.get(tx.envelopeId) ?? [];
      list.push(tx);
      txByEnvelope.set(tx.envelopeId, list);
    }

    return buildEnvelopeTree(envelopes, txByEnvelope, profile.alertThresholdPct);
  }, [user?.id, profile?.cycleAnchorDay, profile?.alertThresholdPct]);
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
