/**
 * Types de domaine partagés entre la base locale (Dexie/IndexedDB) et Supabase.
 * Ces types sont la source de vérité fonctionnelle de Visio : ils reflètent
 * strictement les entités décrites en section 13 du cahier des charges.
 */

export type EnvelopeStatus = "active" | "archived";
export type CycleMode = "inherit" | "custom";
export type TransactionType = "income" | "expense";
export type IntervalUnit = "day" | "week" | "month" | "year";
export type RecurrenceStatus = "active" | "paused" | "ended";
export type PendingRecurrenceStatus = "awaiting_confirmation" | "confirmed" | "dismissed";
export type SyncStatus = "synced" | "pending" | "rejected";

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  defaultCurrency: string; // ISO 4217, ex: "XOF"
  cycleAnchorDay: number; // 1-31 : jour du mois où le cycle global se réinitialise
  alertThresholdPct: number; // seuil d'alerte global par défaut (ex: 80)
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Envelope {
  id: string;
  userId: string;
  parentId: string | null; // null = racine ("Budget général")
  name: string;
  color: string;
  icon: string;
  allocatedAmount: number;
  isRecurring: boolean; // true = le montant se réinitialise à chaque cycle
  cycleMode: CycleMode; // "inherit" = utilise le cycle global du profil
  cycleAnchorDay: number | null; // utilisé seulement si cycleMode === "custom"
  alertThresholdPct: number | null; // surcharge du seuil global pour cette enveloppe
  status: EnvelopeStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  // -- champs de synchronisation locale (n'existent pas côté serveur) --
  syncStatus?: SyncStatus;
}

export interface Transaction {
  id: string;
  userId: string;
  envelopeId: string;
  amount: number; // toujours positif ; le signe est porté par `type`
  type: TransactionType;
  occurredAt: string; // date ISO (YYYY-MM-DD)
  description: string | null;
  recurrenceRuleId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncStatus?: SyncStatus;
}

export interface RecurrenceRule {
  id: string;
  userId: string;
  envelopeId: string;
  amount: number;
  type: TransactionType;
  description: string | null;
  intervalValue: number; // ex: 45
  intervalUnit: IntervalUnit; // ex: "day" -> "tous les 45 jours"
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  status: RecurrenceStatus;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
}

export interface PendingRecurrence {
  id: string;
  userId: string;
  recurrenceRuleId: string;
  envelopeId: string;
  scheduledDate: string;
  amount: number;
  type: TransactionType;
  description: string | null;
  status: PendingRecurrenceStatus;
  createdAt: string;
  resolvedAt: string | null;
  syncStatus?: SyncStatus;
}

export interface Transfer {
  id: string;
  userId: string;
  fromEnvelopeId: string;
  toEnvelopeId: string;
  amount: number;
  note: string | null;
  occurredAt: string;
  createdAt: string;
  syncStatus?: SyncStatus;
}

export interface Attachment {
  id: string;
  userId: string;
  transactionId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  // stockage local avant upload (hors-ligne) : le blob brut
  localBlob?: Blob;
  syncStatus?: SyncStatus;
}

/** Types d'événements consignés dans le journal d'activité (section 5). */
export type JournalEventType =
  | "envelope.create"
  | "envelope.update"
  | "envelope.archive"
  | "envelope.delete"
  | "transaction.create"
  | "transaction.update"
  | "transaction.delete"
  | "transfer.create"
  | "recurrence.create"
  | "recurrence.update"
  | "recurrence.delete"
  | "pending_recurrence.confirm"
  | "pending_recurrence.dismiss"
  | "profile.currency_change"
  | "profile.update";

export type JournalEntityType =
  | "envelope"
  | "transaction"
  | "transfer"
  | "recurrence_rule"
  | "pending_recurrence"
  | "profile";

export interface JournalEvent<TPayload = Record<string, unknown>> {
  id: string;
  userId: string;
  deviceId: string;
  seq?: number; // assigné par le serveur, sert de curseur de synchronisation
  eventType: JournalEventType;
  entityType: JournalEntityType;
  entityId: string;
  payload: TPayload;
  inversePayload: Record<string, unknown> | null;
  clientCreatedAt: string;
  receivedAt?: string;
  isUndone: boolean;
  undoesEventId: string | null;
  status: "applied" | "rejected";
  rejectReason?: string | null;
  syncStatus?: SyncStatus;
}

/** Vue calculée d'une enveloppe pour l'affichage (montant consommé/restant, alertes). */
export interface EnvelopeSummary {
  envelope: Envelope;
  children: EnvelopeSummary[];
  directSpent: number; // dépenses - revenus rattachés directement à ce noeud, sur le cycle en cours
  subtreeSpent: number; // directSpent + somme des subtreeSpent des enfants
  allocatedToChildren: number; // somme des allocated_amount des enfants actifs
  availableForDirect: number; // allocatedAmount - allocatedToChildren
  remaining: number; // allocatedAmount - subtreeSpent
  percentConsumed: number; // subtreeSpent / allocatedAmount * 100 (0 si allocatedAmount = 0)
  isOverBudget: boolean;
  isNearThreshold: boolean;
}
