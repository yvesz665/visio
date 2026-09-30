/**
 * Couche d'accès aux données locales : toute mutation de l'application passe par ici.
 *
 * Chaque fonction :
 *  1. valide les règles métier (allocation, disponibilité de budget...) avec les
 *     fonctions pures de src/lib/domain, en lisant l'état actuel dans Dexie ;
 *  2. applique la mutation à la table concernée ET écrit un événement dans le journal,
 *     dans UNE seule transaction Dexie (donc jamais l'un sans l'autre) ;
 *  3. marque l'événement `syncStatus: "pending"` pour qu'il soit poussé vers Supabase
 *     dès que la connexion est disponible (voir src/lib/sync/engine.ts).
 *
 * C'est ce couplage systématique mutation+journal qui fait du journal d'activité (5)
 * à la fois l'historique consultable, le mécanisme d'annulation, ET la file de
 * synchronisation hors-ligne (10.2) — une seule mécanique pour trois exigences.
 */

import { getDb, getOrCreateDeviceId } from "./dexie";
import type {
  Attachment,
  Envelope,
  JournalEntityType,
  JournalEvent,
  JournalEventType,
  PendingRecurrence,
  Profile,
  RecurrenceRule,
  Transaction,
  Transfer,
} from "@/types/domain";
import {
  AllocationError,
  assertAllocationFits,
  assertNewAmountCoversChildren,
  canHardDelete,
} from "@/lib/domain/envelopes";
import { computeUndoSteps, findMostRecentUndoable, assertIsMostRecent, UndoError } from "@/lib/domain/journal";
import { computeNextRunDate } from "@/lib/domain/recurrence";
import { generateId } from "@/lib/utils/id";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return generateId();
}

async function logEvent(params: {
  eventType: JournalEventType;
  entityType: JournalEntityType;
  entityId: string;
  userId: string;
  payload: Record<string, unknown>;
  inversePayload?: Record<string, unknown> | null;
}): Promise<void> {
  const db = getDb();
  const deviceId = await getOrCreateDeviceId();
  const event: JournalEvent = {
    id: newId(),
    userId: params.userId,
    deviceId,
    eventType: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    payload: params.payload,
    inversePayload: params.inversePayload ?? null,
    clientCreatedAt: nowIso(),
    isUndone: false,
    undoesEventId: null,
    status: "applied",
    syncStatus: "pending",
  };
  await db.journalEvents.add(event);
}

// ============================================================================
// ENVELOPPES
// ============================================================================

export interface CreateEnvelopeInput {
  userId: string;
  parentId: string | null;
  name: string;
  color: string;
  icon: string;
  allocatedAmount: number;
  isRecurring: boolean;
  cycleMode: "inherit" | "custom";
  cycleAnchorDay?: number | null;
  alertThresholdPct?: number | null;
}

export async function createEnvelope(input: CreateEnvelopeInput): Promise<Envelope> {
  const db = getDb();
  return db.transaction("rw", [db.envelopes, db.journalEvents, db.syncMeta], async () => {
    if (input.parentId) {
      const parent = await db.envelopes.get(input.parentId);
      if (!parent) throw new AllocationError("root_immutable_parent", "Enveloppe parente introuvable.");
      const siblings = await db.envelopes
        .where("parentId")
        .equals(input.parentId)
        .filter((e) => e.status === "active")
        .toArray();
      assertAllocationFits(siblings, input.allocatedAmount, parent);
    }

    const envelope: Envelope = {
      id: newId(),
      userId: input.userId,
      parentId: input.parentId,
      name: input.name,
      color: input.color,
      icon: input.icon,
      allocatedAmount: input.allocatedAmount,
      isRecurring: input.isRecurring,
      cycleMode: input.cycleMode,
      cycleAnchorDay: input.cycleAnchorDay ?? null,
      alertThresholdPct: input.alertThresholdPct ?? null,
      status: "active",
      sortOrder: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
      syncStatus: "pending",
    };
    await db.envelopes.add(envelope);
    await logEvent({
      eventType: "envelope.create",
      entityType: "envelope",
      entityId: envelope.id,
      userId: input.userId,
      payload: { ...envelope },
    });
    return envelope;
  });
}

export type EnvelopeUpdatableFields = Partial<
  Pick<
    Envelope,
    | "name"
    | "color"
    | "icon"
    | "allocatedAmount"
    | "isRecurring"
    | "cycleMode"
    | "cycleAnchorDay"
    | "alertThresholdPct"
  >
>;

export async function updateEnvelope(
  envelopeId: string,
  userId: string,
  changes: EnvelopeUpdatableFields
): Promise<Envelope> {
  const db = getDb();
  return db.transaction("rw", [db.envelopes, db.journalEvents, db.syncMeta], async () => {
    const current = await db.envelopes.get(envelopeId);
    if (!current) throw new Error("Enveloppe introuvable.");

    if (changes.allocatedAmount !== undefined && changes.allocatedAmount !== current.allocatedAmount) {
      // Règle 2 : le nouveau montant doit couvrir ce qui est déjà réparti aux enfants.
      const activeChildren = await db.envelopes
        .where("parentId")
        .equals(envelopeId)
        .filter((e) => e.status === "active")
        .toArray();
      assertNewAmountCoversChildren(activeChildren, changes.allocatedAmount);

      // Règle 1 : avec ce nouveau montant, la fratrie ne doit pas dépasser le parent.
      if (current.parentId) {
        const parent = await db.envelopes.get(current.parentId);
        const siblings = await db.envelopes
          .where("parentId")
          .equals(current.parentId)
          .filter((e) => e.status === "active" && e.id !== envelopeId)
          .toArray();
        assertAllocationFits(siblings, changes.allocatedAmount, parent);
      }
    }

    const before: Record<string, unknown> = {};
    for (const key of Object.keys(changes) as (keyof EnvelopeUpdatableFields)[]) {
      before[key] = current[key];
    }

    const updated: Envelope = {
      ...current,
      ...changes,
      updatedAt: nowIso(),
      syncStatus: "pending",
    };
    await db.envelopes.put(updated);
    await logEvent({
      eventType: "envelope.update",
      entityType: "envelope",
      entityId: envelopeId,
      userId,
      payload: { ...changes },
      inversePayload: before,
    });
    return updated;
  });
}

/** Archive (3.5) : jamais de suppression définitive tant que l'enveloppe a des transactions. */
export async function archiveEnvelope(envelopeId: string, userId: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.envelopes, db.journalEvents, db.syncMeta], async () => {
    const current = await db.envelopes.get(envelopeId);
    if (!current) throw new Error("Enveloppe introuvable.");
    await db.envelopes.put({
      ...current,
      status: "archived",
      archivedAt: nowIso(),
      updatedAt: nowIso(),
      syncStatus: "pending",
    });
    await logEvent({
      eventType: "envelope.archive",
      entityType: "envelope",
      entityId: envelopeId,
      userId,
      payload: {},
    });
  });
}

/** Suppression définitive : uniquement si l'enveloppe est vide (3.5). */
export async function hardDeleteEnvelope(envelopeId: string, userId: string): Promise<void> {
  const db = getDb();
  await db.transaction(
    "rw",
    [db.envelopes, db.transactions, db.journalEvents, db.syncMeta],
    async () => {
      const current = await db.envelopes.get(envelopeId);
      if (!current) throw new Error("Enveloppe introuvable.");
      const childCount = await db.envelopes.where("parentId").equals(envelopeId).count();
      const txCount = await db.transactions
        .where("envelopeId")
        .equals(envelopeId)
        .filter((t) => !t.deletedAt)
        .count();
      if (!canHardDelete(txCount > 0, childCount > 0)) {
        throw new AllocationError(
          "not_empty",
          "Cette enveloppe contient des transactions ou des sous-enveloppes : elle sera archivée, pas supprimée."
        );
      }
      await db.envelopes.delete(envelopeId);
      await logEvent({
        eventType: "envelope.delete",
        entityType: "envelope",
        entityId: envelopeId,
        userId,
        payload: {},
        inversePayload: { ...current },
      });
    }
  );
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

export interface CreateTransactionInput {
  userId: string;
  envelopeId: string;
  amount: number;
  type: "income" | "expense";
  occurredAt: string;
  description: string | null;
  recurrenceRuleId?: string | null;
}

export async function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  const db = getDb();
  return db.transaction("rw", [db.transactions, db.journalEvents, db.syncMeta], async () => {
    const tx: Transaction = {
      id: newId(),
      userId: input.userId,
      envelopeId: input.envelopeId,
      amount: input.amount,
      type: input.type,
      occurredAt: input.occurredAt,
      description: input.description,
      recurrenceRuleId: input.recurrenceRuleId ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
      syncStatus: "pending",
    };
    await db.transactions.add(tx);
    await logEvent({
      eventType: "transaction.create",
      entityType: "transaction",
      entityId: tx.id,
      userId: input.userId,
      payload: { ...tx },
    });
    return tx;
  });
}

/**
 * Saisie d'une transaction avec, en option, création d'une règle de récurrence (4.2).
 * La transaction saisie constitue la première occurrence (saisie manuelle : acceptée
 * même en cas de dépassement, 4.3) ; les occurrences suivantes seront gérées par la
 * règle (voir /api/cron/recurrences), avec mise en attente si le budget est insuffisant.
 * Les deux écritures (règle + transaction) partagent une seule transaction Dexie pour
 * rester atomiques.
 */
export async function createTransactionWithOptionalRecurrence(params: {
  userId: string;
  envelopeId: string;
  amount: number;
  type: "income" | "expense";
  occurredAt: string;
  description: string | null;
  recurring: boolean;
  intervalValue: number;
  intervalUnit: RecurrenceRule["intervalUnit"];
  endDate: string | null;
}): Promise<{ transaction: Transaction; rule: RecurrenceRule | null }> {
  const db = getDb();
  return db.transaction(
    "rw",
    [db.transactions, db.recurrenceRules, db.journalEvents, db.syncMeta],
    async () => {
      let rule: RecurrenceRule | null = null;
      if (params.recurring) {
        const firstOccurrence = new Date(`${params.occurredAt}T00:00:00Z`);
        const nextOccurrence = computeNextRunDate(firstOccurrence, params.intervalValue, params.intervalUnit);
        rule = await createRecurrenceRule({
          userId: params.userId,
          envelopeId: params.envelopeId,
          amount: params.amount,
          type: params.type,
          description: params.description,
          intervalValue: params.intervalValue,
          intervalUnit: params.intervalUnit,
          startDate: params.occurredAt,
          endDate: params.endDate,
          initialNextRunDate: nextOccurrence.toISOString().slice(0, 10),
        });
      }
      const tx = await createTransaction({
        userId: params.userId,
        envelopeId: params.envelopeId,
        amount: params.amount,
        type: params.type,
        occurredAt: params.occurredAt,
        description: params.description,
        recurrenceRuleId: rule?.id ?? null,
      });
      return { transaction: tx, rule };
    }
  );
}

export async function updateTransaction(
  transactionId: string,
  userId: string,
  changes: Partial<Pick<Transaction, "amount" | "type" | "occurredAt" | "description" | "envelopeId">>
): Promise<Transaction> {
  const db = getDb();
  return db.transaction("rw", [db.transactions, db.journalEvents, db.syncMeta], async () => {
    const current = await db.transactions.get(transactionId);
    if (!current) throw new Error("Transaction introuvable.");
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
      before[key] = current[key];
    }
    const updated: Transaction = { ...current, ...changes, updatedAt: nowIso(), syncStatus: "pending" };
    await db.transactions.put(updated);
    await logEvent({
      eventType: "transaction.update",
      entityType: "transaction",
      entityId: transactionId,
      userId,
      payload: { ...changes },
      inversePayload: before,
    });
    return updated;
  });
}

/** Suppression logique (soft delete) : nécessaire pour que l'annulation puisse restaurer. */
export async function deleteTransaction(transactionId: string, userId: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.transactions, db.journalEvents, db.syncMeta], async () => {
    const current = await db.transactions.get(transactionId);
    if (!current) throw new Error("Transaction introuvable.");
    await db.transactions.put({ ...current, deletedAt: nowIso(), syncStatus: "pending" });
    await logEvent({
      eventType: "transaction.delete",
      entityType: "transaction",
      entityId: transactionId,
      userId,
      payload: {},
      inversePayload: { deletedAt: null },
    });
  });
}

// ============================================================================
// PIÈCES JOINTES (4.1 : "une pièce justificative optionnelle")
// ============================================================================

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Attache une pièce justificative (photo de reçu/facture) à une transaction. Fonctionne
 * hors-ligne : le fichier est conservé localement (`localBlob`) et sera téléversé vers
 * Supabase Storage par le moteur de synchronisation au retour du réseau (voir
 * src/lib/sync/engine.ts, `syncPendingAttachments`). Pas d'événement de journal dédié :
 * une pièce jointe est un complément optionnel de la transaction, pas une action
 * distincte à journaliser/annuler pour elle-même.
 */
export async function addAttachment(params: {
  userId: string;
  transactionId: string;
  file: File;
}): Promise<Attachment> {
  const db = getDb();
  // Le cahier des charges parle d'"une" pièce justificative (singulier) : on remplace
  // une éventuelle pièce déjà attachée plutôt que d'en accumuler plusieurs. Best-effort
  // uniquement en local ; un fichier déjà envoyé à Storage n'est pas nettoyé côté serveur
  // (coût de stockage négligeable pour un usage personnel).
  const existing = await db.attachments.where("transactionId").equals(params.transactionId).toArray();
  for (const old of existing) await db.attachments.delete(old.id);

  const id = newId();
  const storagePath = `${params.userId}/${params.transactionId}/${id}-${sanitizeFilename(params.file.name)}`;
  const attachment: Attachment = {
    id,
    userId: params.userId,
    transactionId: params.transactionId,
    storagePath,
    mimeType: params.file.type || "application/octet-stream",
    sizeBytes: params.file.size,
    createdAt: nowIso(),
    localBlob: params.file,
    syncStatus: "pending",
  };
  await db.attachments.add(attachment);
  return attachment;
}

export async function removeAttachment(attachmentId: string): Promise<void> {
  const db = getDb();
  await db.attachments.delete(attachmentId);
  // Le fichier resterait dans Storage si déjà synchronisé ; nettoyage best-effort,
  // sans bloquer l'utilisateur hors-ligne (non critique : espace de stockage modeste
  // pour un usage personnel, et sans incidence sur la confidentialité des autres données).
}

// ============================================================================
// RÈGLES DE RÉCURRENCE (4.2)
// ============================================================================

export interface CreateRecurrenceInput {
  userId: string;
  envelopeId: string;
  amount: number;
  type: "income" | "expense";
  description: string | null;
  intervalValue: number;
  intervalUnit: RecurrenceRule["intervalUnit"];
  startDate: string;
  endDate: string | null;
  /**
   * Date de la prochaine occurrence à générer automatiquement. Par défaut égale à
   * `startDate` (la règle démarre "à blanc"). À passer explicitement à la date
   * calculée par `computeNextRunDate` quand la toute première occurrence a déjà été
   * saisie manuellement ailleurs (voir createTransactionWithOptionalRecurrence),
   * pour éviter que le job planifié ne la génère une seconde fois.
   */
  initialNextRunDate?: string;
}

export async function createRecurrenceRule(input: CreateRecurrenceInput): Promise<RecurrenceRule> {
  const db = getDb();
  return db.transaction("rw", [db.recurrenceRules, db.journalEvents, db.syncMeta], async () => {
    const rule: RecurrenceRule = {
      id: newId(),
      userId: input.userId,
      envelopeId: input.envelopeId,
      amount: input.amount,
      type: input.type,
      description: input.description,
      intervalValue: input.intervalValue,
      intervalUnit: input.intervalUnit,
      startDate: input.startDate,
      endDate: input.endDate,
      nextRunDate: input.initialNextRunDate ?? input.startDate,
      status: "active",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      syncStatus: "pending",
    };
    await db.recurrenceRules.add(rule);
    await logEvent({
      eventType: "recurrence.create",
      entityType: "recurrence_rule",
      entityId: rule.id,
      userId: input.userId,
      payload: { ...rule },
    });
    return rule;
  });
}

export async function updateRecurrenceRule(
  ruleId: string,
  userId: string,
  changes: Partial<Pick<RecurrenceRule, "amount" | "description" | "endDate" | "status" | "nextRunDate">>
): Promise<RecurrenceRule> {
  const db = getDb();
  return db.transaction("rw", [db.recurrenceRules, db.journalEvents, db.syncMeta], async () => {
    const current = await db.recurrenceRules.get(ruleId);
    if (!current) throw new Error("Règle de récurrence introuvable.");
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
      before[key] = current[key];
    }
    const updated: RecurrenceRule = { ...current, ...changes, updatedAt: nowIso(), syncStatus: "pending" };
    await db.recurrenceRules.put(updated);
    await logEvent({
      eventType: "recurrence.update",
      entityType: "recurrence_rule",
      entityId: ruleId,
      userId,
      payload: { ...changes },
      inversePayload: before,
    });
    return updated;
  });
}

/**
 * Arrête une règle de récurrence future sans toucher aux occurrences déjà générées
 * (4.2 : "modifier ou supprimer une occurrence future sans affecter les occurrences
 * déjà passées"). Implémenté comme une suppression complète de la règle : les
 * transactions déjà créées par occurrences passées restent inchangées car elles sont
 * des lignes indépendantes dans `transactions`.
 */
export async function deleteRecurrenceRule(ruleId: string, userId: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.recurrenceRules, db.journalEvents, db.syncMeta], async () => {
    const current = await db.recurrenceRules.get(ruleId);
    if (!current) throw new Error("Règle de récurrence introuvable.");
    await db.recurrenceRules.delete(ruleId);
    await logEvent({
      eventType: "recurrence.delete",
      entityType: "recurrence_rule",
      entityId: ruleId,
      userId,
      payload: {},
      inversePayload: { ...current },
    });
  });
}

// ============================================================================
// TRANSFERTS (3.3)
// ============================================================================

export async function createTransfer(params: {
  userId: string;
  fromEnvelopeId: string;
  toEnvelopeId: string;
  amount: number;
  note?: string | null;
}): Promise<Transfer> {
  const db = getDb();
  return db.transaction("rw", [db.envelopes, db.transfers, db.journalEvents, db.syncMeta], async () => {
    const from = await db.envelopes.get(params.fromEnvelopeId);
    const to = await db.envelopes.get(params.toEnvelopeId);
    if (!from || !to) throw new Error("Enveloppe source ou destination introuvable.");

    const fromNewAmount = from.allocatedAmount - params.amount;
    if (fromNewAmount < 0) {
      throw new AllocationError("allocation_exceeds_new_amount", "Solde insuffisant sur l'enveloppe source.");
    }
    const fromChildren = await db.envelopes
      .where("parentId")
      .equals(from.id)
      .filter((e) => e.status === "active")
      .toArray();
    assertNewAmountCoversChildren(fromChildren, fromNewAmount);

    const toNewAmount = to.allocatedAmount + params.amount;
    if (to.parentId) {
      const toParent = await db.envelopes.get(to.parentId);
      const toSiblings = await db.envelopes
        .where("parentId")
        .equals(to.parentId)
        .filter((e) => e.status === "active" && e.id !== to.id)
        .toArray();
      assertAllocationFits(toSiblings, toNewAmount, toParent);
    }

    await db.envelopes.put({ ...from, allocatedAmount: fromNewAmount, updatedAt: nowIso(), syncStatus: "pending" });
    await db.envelopes.put({ ...to, allocatedAmount: toNewAmount, updatedAt: nowIso(), syncStatus: "pending" });

    const transfer: Transfer = {
      id: newId(),
      userId: params.userId,
      fromEnvelopeId: from.id,
      toEnvelopeId: to.id,
      amount: params.amount,
      note: params.note ?? null,
      occurredAt: nowIso(),
      createdAt: nowIso(),
      syncStatus: "pending",
    };
    await db.transfers.add(transfer);
    await logEvent({
      eventType: "transfer.create",
      entityType: "transfer",
      entityId: transfer.id,
      userId: params.userId,
      payload: {
        fromEnvelopeId: from.id,
        toEnvelopeId: to.id,
        amount: params.amount,
        fromAllocatedBefore: from.allocatedAmount,
        toAllocatedBefore: to.allocatedAmount,
      },
    });
    return transfer;
  });
}

// ============================================================================
// RÉCURRENCES EN ATTENTE (4.2)
// ============================================================================

export async function confirmPendingRecurrence(
  pending: PendingRecurrence,
  userId: string
): Promise<Transaction> {
  const db = getDb();
  return db.transaction(
    "rw",
    [db.pendingRecurrences, db.transactions, db.journalEvents, db.syncMeta],
    async () => {
      const tx: Transaction = {
        id: newId(),
        userId,
        envelopeId: pending.envelopeId,
        amount: pending.amount,
        type: pending.type,
        occurredAt: pending.scheduledDate,
        description: pending.description,
        recurrenceRuleId: pending.recurrenceRuleId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        deletedAt: null,
        syncStatus: "pending",
      };
      await db.transactions.add(tx);
      await db.pendingRecurrences.put({
        ...pending,
        status: "confirmed",
        resolvedAt: nowIso(),
        syncStatus: "pending",
      });
      // Un seul événement journal pour toute l'action ("confirmer cette échéance"),
      // avec la transaction complète en charge utile : l'annulation (et la synchronisation,
      // qui doit pouvoir recréer la transaction sans dépendre d'un autre événement) n'ont
      // ainsi besoin que de cet unique événement.
      await logEvent({
        eventType: "pending_recurrence.confirm",
        entityType: "pending_recurrence",
        entityId: pending.id,
        userId,
        payload: { createdTransactionId: tx.id, transaction: { ...tx } },
      });
      return tx;
    }
  );
}

export async function dismissPendingRecurrence(pending: PendingRecurrence, userId: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.pendingRecurrences, db.journalEvents, db.syncMeta], async () => {
    await db.pendingRecurrences.put({
      ...pending,
      status: "dismissed",
      resolvedAt: nowIso(),
      syncStatus: "pending",
    });
    await logEvent({
      eventType: "pending_recurrence.dismiss",
      entityType: "pending_recurrence",
      entityId: pending.id,
      userId,
      payload: {},
    });
  });
}

// ============================================================================
// CHANGEMENT DE DEVISE (9.3)
// ============================================================================

export async function changeCurrency(params: {
  userId: string;
  profile: Profile;
  newCurrency: string;
  rate: number;
}): Promise<void> {
  const db = getDb();
  await db.transaction(
    "rw",
    [db.profiles, db.envelopes, db.transactions, db.recurrenceRules, db.journalEvents, db.syncMeta],
    async () => {
      const envelopes = await db.envelopes.where("userId").equals(params.userId).toArray();
      const transactions = await db.transactions.where("userId").equals(params.userId).toArray();
      const rules = await db.recurrenceRules.where("userId").equals(params.userId).toArray();

      const prevEnvelopeAmounts: Record<string, number> = {};
      const prevTransactionAmounts: Record<string, number> = {};
      const prevRecurrenceAmounts: Record<string, number> = {};

      for (const e of envelopes) {
        prevEnvelopeAmounts[e.id] = e.allocatedAmount;
        await db.envelopes.put({
          ...e,
          allocatedAmount: Math.round(e.allocatedAmount * params.rate * 100) / 100,
          syncStatus: "pending",
        });
      }
      for (const t of transactions) {
        prevTransactionAmounts[t.id] = t.amount;
        await db.transactions.put({
          ...t,
          amount: Math.round(t.amount * params.rate * 100) / 100,
          syncStatus: "pending",
        });
      }
      for (const r of rules) {
        prevRecurrenceAmounts[r.id] = r.amount;
        await db.recurrenceRules.put({
          ...r,
          amount: Math.round(r.amount * params.rate * 100) / 100,
          syncStatus: "pending",
        });
      }

      await db.profiles.put({
        ...params.profile,
        defaultCurrency: params.newCurrency,
        updatedAt: nowIso(),
      });

      await logEvent({
        eventType: "profile.currency_change",
        entityType: "profile",
        entityId: params.userId,
        userId: params.userId,
        payload: {
          fromCurrency: params.profile.defaultCurrency,
          toCurrency: params.newCurrency,
          rate: params.rate,
        },
        inversePayload: {
          previousCurrency: params.profile.defaultCurrency,
          envelopeAllocations: prevEnvelopeAmounts,
          transactionAmounts: prevTransactionAmounts,
          recurrenceAmounts: prevRecurrenceAmounts,
        },
      });
    }
  );
}

// ============================================================================
// PROFIL (paramètres généraux hors devise, ex : seuil d'alerte global, section 6)
// ============================================================================

export async function updateProfile(
  userId: string,
  changes: Partial<Pick<Profile, "displayName" | "alertThresholdPct" | "cycleAnchorDay" | "onboardingCompleted">>
): Promise<Profile> {
  const db = getDb();
  return db.transaction("rw", [db.profiles, db.journalEvents, db.syncMeta], async () => {
    const current = await db.profiles.get(userId);
    if (!current) throw new Error("Profil introuvable.");
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
      before[key] = current[key];
    }
    const updated: Profile = { ...current, ...changes, updatedAt: nowIso() };
    await db.profiles.put(updated);
    await logEvent({
      eventType: "profile.update",
      entityType: "profile",
      entityId: userId,
      userId,
      payload: { ...changes },
      inversePayload: before,
    });
    return updated;
  });
}

// ============================================================================
// ANNULATION (5) — ne porte jamais que sur la toute dernière action
// ============================================================================

export async function undoLastAction(userId: string): Promise<JournalEvent | null> {
  const db = getDb();
  return db.transaction(
    "rw",
    [
      db.envelopes,
      db.transactions,
      db.recurrenceRules,
      db.pendingRecurrences,
      db.transfers,
      db.profiles,
      db.journalEvents,
      db.syncMeta,
    ],
    async () => {
      const allEvents = await db.journalEvents.where("userId").equals(userId).toArray();
      const target = findMostRecentUndoable(allEvents);
      if (!target) throw new UndoError("nothing_to_undo", "Aucune action à annuler.");
      assertIsMostRecent(target, allEvents);

      const steps = computeUndoSteps(target);
      for (const step of steps) {
        if (step.op === "delete") {
          await deleteFromTable(step.table, step.id);
        } else {
          await upsertIntoTable(step.table, step.id, step.data ?? {});
        }
      }

      await db.journalEvents.put({ ...target, isUndone: true, syncStatus: "pending" });
      return target;
    }
  );
}

async function deleteFromTable(table: string, id: string): Promise<void> {
  const db = getDb();
  switch (table) {
    case "envelopes":
      return void (await db.envelopes.delete(id));
    case "transactions":
      return void (await db.transactions.delete(id));
    case "recurrence_rules":
      return void (await db.recurrenceRules.delete(id));
    case "transfers":
      return void (await db.transfers.delete(id));
    case "pending_recurrences":
      return void (await db.pendingRecurrences.delete(id));
    case "profiles":
      return void (await db.profiles.delete(id));
  }
}

async function upsertIntoTable(table: string, id: string, data: Record<string, unknown>): Promise<void> {
  const db = getDb();
  switch (table) {
    case "envelopes": {
      const current = await db.envelopes.get(id);
      const merged = current
        ? { ...current, ...data, syncStatus: "pending" as const }
        : ({ id, ...data } as Envelope);
      return void (await db.envelopes.put(merged));
    }
    case "transactions": {
      const current = await db.transactions.get(id);
      const merged = current
        ? { ...current, ...data, syncStatus: "pending" as const }
        : ({ id, ...data } as Transaction);
      return void (await db.transactions.put(merged));
    }
    case "recurrence_rules": {
      const current = await db.recurrenceRules.get(id);
      const merged = current
        ? { ...current, ...data, syncStatus: "pending" as const }
        : ({ id, ...data } as RecurrenceRule);
      return void (await db.recurrenceRules.put(merged));
    }
    case "pending_recurrences": {
      const current = await db.pendingRecurrences.get(id);
      const merged = current
        ? { ...current, ...data, syncStatus: "pending" as const }
        : ({ id, ...data } as PendingRecurrence);
      return void (await db.pendingRecurrences.put(merged));
    }
    case "profiles": {
      const current = await db.profiles.get(id);
      const merged = current ? { ...current, ...data } : ({ id, ...data } as Profile);
      return void (await db.profiles.put(merged));
    }
  }
}
