/**
 * Export complet des données d'un utilisateur au format JSON, utilisé avant la
 * suppression de compte (9.4 : "l'application lui propose d'exporter l'ensemble de ses
 * données") et disponible aussi à tout moment depuis les réglages. Fonctionne hors-ligne
 * puisqu'il lit uniquement IndexedDB.
 */

import { getDb } from "@/lib/db/dexie";
import { downloadBlob } from "./download";

export async function exportAllDataAsJson(userId: string): Promise<void> {
  const db = getDb();
  const [profile, envelopes, transactions, recurrenceRules, pendingRecurrences, transfers, journalEvents] =
    await Promise.all([
      db.profiles.get(userId),
      db.envelopes.where("userId").equals(userId).toArray(),
      db.transactions.where("userId").equals(userId).toArray(),
      db.recurrenceRules.where("userId").equals(userId).toArray(),
      db.pendingRecurrences.where("userId").equals(userId).toArray(),
      db.transfers.where("userId").equals(userId).toArray(),
      db.journalEvents.where("userId").equals(userId).toArray(),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    profile,
    envelopes,
    transactions,
    recurrenceRules,
    pendingRecurrences,
    transfers,
    journalEvents,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `visio-export-${new Date().toISOString().slice(0, 10)}.json`);
}
