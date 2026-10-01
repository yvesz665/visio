/**
 * Types de domaine partagés entre la base locale (Dexie/IndexedDB) et Supabase.
 * Ces types sont la source de vérité fonctionnelle de Visio : ils reflètent
 * strictement les entités décrites en section 13 du cahier des charges.
 *
 * CONVENTION MONÉTAIRE : tous les champs `amount`/`allocatedAmount`/etc. sont des
 * ENTIERS en sous-unité ×100 de la devise (ex : 50 000 XOF est stocké 5 000 000 ;
 * 76,22 EUR est stocké 7 622), y compris pour les devises sans centimes d'usage comme
 * le XOF. Ce choix évite toute dérive d'arrondi lors des changements de devise (voir
 * src/lib/domain/currency.ts, seule source d'arrondi). Ne jamais stocker de nombre à
 * virgule flottante représentant un montant ; toujours passer par
 * `toMinorUnits`/`fromMinorUnits`/`formatMoney`.
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
  timezone: string; // fuseau IANA (ex: "Africa/Ouagadougou"), utilisé pour les bornes de cycle
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
  allocatedAmount: number; // sous-unité ×100 ; jamais modifié par un transfert (voir Transfer)
  isRecurring: boolean; // true = le montant se réinitialise à chaque cycle, avec report
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
  /**
   * null = dépense/remboursement "hors budget" : ne compte dans le dépensé d'aucune
   * enveloppe, mais entre dans le solde réel, l'historique, les filtres et l'export.
   */
  envelopeId: string | null;
  amount: number; // sous-unité ×100, toujours positif ; le signe est porté par `type`
  /**
   * "expense" = dépense. "income" rattaché à une enveloppe est affiché "Remboursement"
   * dans l'UI (ex : un ami qui rembourse une dépense) : il réduit le dépensé de cette
   * enveloppe ET compte dans le solde réel, à la différence d'une "rentrée" (IncomeEntry)
   * qui est un revenu réel, indépendant de toute enveloppe.
   */
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
  envelopeId: string | null;
  amount: number; // sous-unité ×100
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
  envelopeId: string | null;
  scheduledDate: string;
  amount: number; // sous-unité ×100
  type: TransactionType;
  description: string | null;
  status: PendingRecurrenceStatus;
  createdAt: string;
  resolvedAt: string | null;
  syncStatus?: SyncStatus;
}

/**
 * Transfert entre deux enveloppes (3.3). NE modifie JAMAIS `allocatedAmount` : son effet
 * est purement local à la période en cours des deux enveloppes concernées
 * (transfers_in / transfers_out, voir EnvelopePeriod), et ne se propage aux périodes
 * suivantes que via le report normal. Cela évite qu'un transfert change silencieusement
 * l'allocation de toutes les périodes futures, et qu'il puisse casser la règle
 * "somme des enfants ≤ parent" (qui ne porte que sur allocatedAmount).
 */
export interface Transfer {
  id: string;
  userId: string;
  fromEnvelopeId: string;
  toEnvelopeId: string;
  amount: number; // sous-unité ×100
  note: string | null;
  occurredAt: string;
  createdAt: string;
  syncStatus?: SyncStatus;
}

/**
 * Grand livre d'une période close d'une enveloppe récurrente (report d'une période à
 * l'autre). Seules les périodes CLOSES sont persistées ; la période en cours est
 * toujours recalculée à la volée (voir src/lib/domain/periods.ts) à partir du dernier
 * report connu + de l'état courant. Autorité : les fonctions Postgres
 * `close_envelope_period` / `recalculate_periods_from` (supabase/migrations).
 */
export interface EnvelopePeriod {
  id: string;
  envelopeId: string;
  userId: string;
  cycleStart: string; // date ISO
  cycleEnd: string; // date ISO (exclusive)
  allocatedAmount: number; // instantané du montant alloué à la clôture
  carryIn: number; // report reçu de la période précédente (peut être négatif)
  transfersIn: number;
  transfersOut: number;
  spent: number; // dépenses - remboursements, agrégé sur le sous-arbre
  carryOut: number; // = disponible en fin de période = carryIn de la période suivante
  closedAt: string;
  syncStatus?: SyncStatus;
}

/** Source d'une rentrée d'argent (9.3-like : liste par défaut modifiable par l'utilisateur). */
export interface IncomeSource {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  syncStatus?: SyncStatus;
}

/**
 * Rentrée d'argent réelle (salaire, bourse, etc.), totalement indépendante des
 * enveloppes : n'alimente aucun montant alloué. N'entre dans le calcul du solde réel
 * qu'avec les dépenses/remboursements (voir computeSoldeReel dans periods.ts).
 */
export interface IncomeEntry {
  id: string;
  userId: string;
  amount: number; // sous-unité ×100
  occurredAt: string;
  sourceId: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
  | "income_entry.create"
  | "income_entry.update"
  | "income_entry.delete"
  | "income_source.create"
  | "income_source.update"
  | "income_source.delete"
  | "profile.currency_change"
  | "profile.update";

export type JournalEntityType =
  | "envelope"
  | "transaction"
  | "transfer"
  | "recurrence_rule"
  | "pending_recurrence"
  | "income_entry"
  | "income_source"
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

/**
 * Vue calculée d'une enveloppe pour l'affichage (report, disponible, alertes). Reflète
 * exactement la formule du cahier des charges :
 * disponible = alloué + report reçu + transferts entrants - transferts sortants - dépensé.
 */
export interface EnvelopeSummary {
  envelope: Envelope;
  children: EnvelopeSummary[];
  directSpent: number; // dépenses - remboursements rattachés directement à ce noeud, cycle en cours
  subtreeSpent: number; // directSpent + somme des subtreeSpent des enfants
  allocatedToChildren: number; // somme des allocated_amount des enfants actifs
  availableForDirect: number; // allocatedAmount - allocatedToChildren
  carryIn: number; // report reçu (0 si pas récurrente ou première période)
  transfersIn: number; // transferts entrants sur la période en cours
  transfersOut: number; // transferts sortants sur la période en cours
  /** Bornes du cycle effectivement utilisées pour ce calcul (ISO) ; null si pas de fenêtre (non récurrente). */
  cycleStart: string | null;
  cycleEnd: string | null;
  remaining: number; // = disponible = allocatedAmount + carryIn + transfersIn - transfersOut - subtreeSpent
  percentConsumed: number; // subtreeSpent / allocatedAmount * 100 (0 si allocatedAmount = 0)
  isOverBudget: boolean; // remaining < 0
  isNearThreshold: boolean;
  /** true si le calcul inclut des mutations locales pas encore synchronisées (10.2). */
  isProvisional: boolean;
}
