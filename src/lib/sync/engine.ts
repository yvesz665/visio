/**
 * Moteur de synchronisation hors-ligne (10.2).
 *
 * Contrat avec le serveur (voir src/app/api/sync/*) :
 *  - POST /api/sync/push : envoie un lot d'événements du journal local pas encore
 *    synchronisés ; le serveur les applique un par un, de façon idempotente (id unique),
 *    revalide les règles métier, et répond pour chacun "applied" ou "rejected" (+ raison).
 *  - GET /api/sync/pull?since=<seq> : renvoie les événements plus récents que `seq`
 *    (créés par ce compte depuis un autre appareil, ou rejoués côté serveur) ainsi que
 *    l'état à jour ("snapshot") de chaque entité qu'ils concernent. Le client applique
 *    ces snapshots tels quels (le serveur fait autorité une fois la fusion faite), ce
 *    qui évite d'avoir à rejouer des diffs côté client.
 *
 * La synchronisation ne doit jamais bloquer l'usage de l'app (11.2) : elle tourne en
 * tâche de fond, avec re-essai, et l'UI continue de lire/écrire dans IndexedDB pendant
 * ce temps.
 */

import { getDb, getSyncCursor, setSyncCursor } from "@/lib/db/dexie";
import type {
  Envelope,
  JournalEvent,
  PendingRecurrence,
  Profile,
  RecurrenceRule,
  Transaction,
  Transfer,
} from "@/types/domain";

export interface PushResult {
  id: string;
  status: "applied" | "rejected";
  reason?: string;
}

export interface PullResponse {
  events: JournalEvent[];
  cursor: number;
  snapshots: {
    envelopes?: Envelope[];
    transactions?: Transaction[];
    recurrenceRules?: RecurrenceRule[];
    pendingRecurrences?: PendingRecurrence[];
    transfers?: Transfer[];
    profile?: Profile;
  };
  deletions?: {
    envelopes?: string[];
    recurrenceRules?: string[];
  };
}

type AuthTokenProvider = () => Promise<string | null>;

let getAuthToken: AuthTokenProvider = async () => null;
export function setAuthTokenProvider(fn: AuthTokenProvider): void {
  getAuthToken = fn;
}

let isSyncing = false;
let syncQueued = false;
const listeners = new Set<(state: SyncState) => void>();

export type SyncState = "idle" | "syncing" | "offline" | "error";
let currentState: SyncState = "idle";

function setState(state: SyncState): void {
  currentState = state;
  listeners.forEach((l) => l(state));
}

export function onSyncStateChange(fn: (state: SyncState) => void): () => void {
  listeners.add(fn);
  fn(currentState);
  return () => listeners.delete(fn);
}

/** Déclenche une synchronisation, en évitant les exécutions concurrentes (debounce simple). */
export async function scheduleSync(): Promise<void> {
  if (isSyncing) {
    syncQueued = true;
    return;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setState("offline");
    return;
  }
  isSyncing = true;
  setState("syncing");
  try {
    await pushPendingEvents();
    await pullRemoteEvents();
    await syncPendingAttachments();
    setState("idle");
  } catch (err) {
    console.error("[sync] échec de synchronisation", err);
    setState("error");
  } finally {
    isSyncing = false;
    if (syncQueued) {
      syncQueued = false;
      void scheduleSync();
    }
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function pushPendingEvents(): Promise<void> {
  const db = getDb();
  const pending = await db.journalEvents.where("syncStatus").equals("pending").sortBy("clientCreatedAt");
  if (pending.length === 0) return;

  const BATCH_SIZE = 50;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) {
      throw new Error(`push a échoué avec le statut ${res.status}`);
    }
    const results: PushResult[] = (await res.json()).results;
    await db.transaction("rw", db.journalEvents, async () => {
      for (const result of results) {
        const event = await db.journalEvents.get(result.id);
        if (!event) continue;
        await db.journalEvents.put({
          ...event,
          syncStatus: result.status === "applied" ? "synced" : "rejected",
          status: result.status === "applied" ? "applied" : "rejected",
          rejectReason: result.reason ?? null,
        });
      }
    });
  }
}

async function pullRemoteEvents(): Promise<void> {
  const db = getDb();
  const since = await getSyncCursor();
  const res = await fetch(`/api/sync/pull?since=${since}`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`pull a échoué avec le statut ${res.status}`);
  }
  const data: PullResponse = await res.json();

  await db.transaction(
    "rw",
    [
      db.envelopes,
      db.transactions,
      db.recurrenceRules,
      db.pendingRecurrences,
      db.transfers,
      db.profiles,
      db.journalEvents,
    ],
    async () => {
      for (const e of data.snapshots.envelopes ?? []) await db.envelopes.put(e);
      for (const t of data.snapshots.transactions ?? []) await db.transactions.put(t);
      for (const r of data.snapshots.recurrenceRules ?? []) await db.recurrenceRules.put(r);
      for (const p of data.snapshots.pendingRecurrences ?? []) await db.pendingRecurrences.put(p);
      for (const tr of data.snapshots.transfers ?? []) await db.transfers.put(tr);
      if (data.snapshots.profile) await db.profiles.put(data.snapshots.profile);

      for (const id of data.deletions?.envelopes ?? []) await db.envelopes.delete(id);
      for (const id of data.deletions?.recurrenceRules ?? []) await db.recurrenceRules.delete(id);

      for (const event of data.events) {
        const existing = await db.journalEvents.get(event.id);
        if (existing) continue; // déjà connu (événement produit par cet appareil)
        await db.journalEvents.add({ ...event, syncStatus: "synced" });
      }
    }
  );

  if (data.cursor > since) {
    await setSyncCursor(data.cursor);
  }
}

/**
 * Téléverse les pièces jointes créées hors-ligne (4.1) vers Supabase Storage.
 *
 * Exception délibérée à la règle "jamais le SDK Supabase directement pour les données
 * budgétaires" (voir ARCHITECTURE.md) : une pièce jointe est un artefact binaire
 * optionnel, sans règle métier à revalider et sans besoin de lecture hors-ligne (une
 * photo de reçu ne peut de toute façon s'afficher que si l'appareil est en ligne). Le
 * détour par nos propres routes API n'apporterait rien ici ; Storage + la table
 * `attachments` sont protégés par les mêmes policies RLS que le reste.
 */
async function syncPendingAttachments(): Promise<void> {
  const db = getDb();
  const pending = await db.attachments.where("syncStatus").equals("pending").toArray();
  if (pending.length === 0) return;

  const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
  const supabase = getSupabaseBrowserClient();

  for (const attachment of pending) {
    if (!attachment.localBlob) continue;
    try {
      const { error: uploadError } = await supabase.storage
        .from("attachments")
        .upload(attachment.storagePath, attachment.localBlob, {
          contentType: attachment.mimeType,
          upsert: true,
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("attachments").upsert(
        {
          id: attachment.id,
          user_id: attachment.userId,
          transaction_id: attachment.transactionId,
          storage_path: attachment.storagePath,
          mime_type: attachment.mimeType,
          size_bytes: attachment.sizeBytes,
        },
        { onConflict: "id" }
      );
      if (insertError) throw insertError;

      await db.attachments.put({ ...attachment, syncStatus: "synced", localBlob: undefined });
    } catch (err) {
      console.error("[sync] échec de l'envoi d'une pièce jointe", err);
      // On réessaiera au prochain cycle de synchronisation ; le blob reste en local.
    }
  }
}

/** À appeler une fois au démarrage de l'app pour réagir au retour de connexion. */
export function initNetworkListeners(): () => void {
  const handleOnline = () => void scheduleSync();
  window.addEventListener("online", handleOnline);
  // Filet de sécurité : nouvelle tentative périodique, y compris si l'évènement
  // "online" du navigateur n'est pas fiable sur toutes les plateformes.
  const interval = setInterval(() => {
    if (navigator.onLine) void scheduleSync();
  }, 60_000);

  return () => {
    window.removeEventListener("online", handleOnline);
    clearInterval(interval);
  };
}
