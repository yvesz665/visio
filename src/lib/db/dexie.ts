/**
 * Base locale IndexedDB (via Dexie) : source de vérité pour l'UI, en ligne comme
 * hors-ligne (10.2). Toute lecture/écriture de l'application passe par cette base ;
 * la synchronisation avec Supabase se fait en tâche de fond (voir src/lib/sync).
 */

import Dexie, { type Table } from "dexie";
import { generateId } from "@/lib/utils/id";
import type {
  Attachment,
  Envelope,
  JournalEvent,
  PendingRecurrence,
  Profile,
  RecurrenceRule,
  Transaction,
  Transfer,
} from "@/types/domain";

export interface SyncMeta {
  key: string; // ex: "cursor", "deviceId"
  value: string;
}

export class VisioDatabase extends Dexie {
  profiles!: Table<Profile, string>;
  envelopes!: Table<Envelope, string>;
  transactions!: Table<Transaction, string>;
  recurrenceRules!: Table<RecurrenceRule, string>;
  pendingRecurrences!: Table<PendingRecurrence, string>;
  transfers!: Table<Transfer, string>;
  attachments!: Table<Attachment, string>;
  journalEvents!: Table<JournalEvent, string>;
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    super("visio-db");
    this.version(1).stores({
      profiles: "id",
      envelopes: "id, parentId, userId, status, [userId+parentId]",
      transactions: "id, envelopeId, userId, occurredAt, deletedAt, recurrenceRuleId",
      recurrenceRules: "id, envelopeId, userId, status, nextRunDate",
      pendingRecurrences: "id, recurrenceRuleId, userId, status",
      transfers: "id, userId, fromEnvelopeId, toEnvelopeId",
      attachments: "id, transactionId, userId, syncStatus",
      journalEvents: "id, userId, clientCreatedAt, isUndone, syncStatus, seq",
      syncMeta: "key",
    });
  }
}

let dbInstance: VisioDatabase | null = null;

/** Instance unique de la base locale (lazy, car IndexedDB n'existe pas côté serveur). */
export function getDb(): VisioDatabase {
  if (typeof window === "undefined") {
    throw new Error("VisioDatabase ne peut être utilisée que côté client (IndexedDB).");
  }
  if (!dbInstance) {
    dbInstance = new VisioDatabase();
  }
  return dbInstance;
}

const DEVICE_ID_KEY = "deviceId";

/** Identifiant stable de cet appareil/navigateur, utilisé pour attribuer les événements. */
export async function getOrCreateDeviceId(): Promise<string> {
  const db = getDb();
  const existing = await db.syncMeta.get(DEVICE_ID_KEY);
  if (existing) return existing.value;
  const id = generateId();
  await db.syncMeta.put({ key: DEVICE_ID_KEY, value: id });
  return id;
}

export async function getSyncCursor(): Promise<number> {
  const db = getDb();
  const row = await db.syncMeta.get("cursor");
  return row ? Number(row.value) : 0;
}

export async function setSyncCursor(seq: number): Promise<void> {
  const db = getDb();
  await db.syncMeta.put({ key: "cursor", value: String(seq) });
}

/** Purge complète de la base locale (déconnexion ou suppression de compte, 9.4). */
export async function clearLocalDatabase(): Promise<void> {
  const db = getDb();
  await db.transaction(
    "rw",
    [
      db.profiles,
      db.envelopes,
      db.transactions,
      db.recurrenceRules,
      db.pendingRecurrences,
      db.transfers,
      db.attachments,
      db.journalEvents,
      db.syncMeta,
    ],
    async () => {
      await Promise.all([
        db.profiles.clear(),
        db.envelopes.clear(),
        db.transactions.clear(),
        db.recurrenceRules.clear(),
        db.pendingRecurrences.clear(),
        db.transfers.clear(),
        db.attachments.clear(),
        db.journalEvents.clear(),
        db.syncMeta.clear(),
      ]);
    }
  );
}
