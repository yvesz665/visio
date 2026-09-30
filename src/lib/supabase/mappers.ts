/**
 * Conversion entre les objets de domaine (camelCase, utilisés partout dans l'app et
 * dans Dexie) et les lignes Postgres (snake_case, telles que définies dans
 * supabase/migrations/0001_init.sql). Centraliser cette conversion ici évite de la
 * disperser dans chaque route API.
 */

import type {
  Envelope,
  JournalEvent,
  PendingRecurrence,
  Profile,
  RecurrenceRule,
  Transaction,
  Transfer,
} from "@/types/domain";


/**
 * Tables des correspondances camelCase -> snake_case, utilisées pour convertir les
 * charges utiles PARTIELLES des événements `*.update` (seuls les champs modifiés sont
 * présents) sans devoir reconstruire l'objet complet.
 */
const KEY_MAPS = {
  envelope: {
    name: "name",
    color: "color",
    icon: "icon",
    allocatedAmount: "allocated_amount",
    isRecurring: "is_recurring",
    cycleMode: "cycle_mode",
    cycleAnchorDay: "cycle_anchor_day",
    alertThresholdPct: "alert_threshold_pct",
    status: "status",
    archivedAt: "archived_at",
  },
  transaction: {
    amount: "amount",
    type: "type",
    occurredAt: "occurred_at",
    description: "description",
    envelopeId: "envelope_id",
    deletedAt: "deleted_at",
  },
  recurrence_rule: {
    amount: "amount",
    type: "type",
    description: "description",
    intervalValue: "interval_value",
    intervalUnit: "interval_unit",
    startDate: "start_date",
    endDate: "end_date",
    nextRunDate: "next_run_date",
    status: "status",
  },
  pending_recurrence: {
    status: "status",
    resolvedAt: "resolved_at",
  },
  profile: {
    displayName: "display_name",
    defaultCurrency: "default_currency",
    cycleAnchorDay: "cycle_anchor_day",
    alertThresholdPct: "alert_threshold_pct",
    onboardingCompleted: "onboarding_completed",
  },
} as const;

export type MappableEntity = keyof typeof KEY_MAPS;

/** Convertit un objet partiel (camelCase) en ligne partielle (snake_case) pour un UPDATE. */
export function partialToRow(entity: MappableEntity, partial: Record<string, unknown>): Record<string, unknown> {
  const map = KEY_MAPS[entity] as Record<string, string>;
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(partial)) {
    const column = map[key];
    if (column) row[column] = value;
  }
  return row;
}

export function profileToRow(p: Profile): Record<string, unknown> {
  return {
    id: p.id,
    email: p.email,
    display_name: p.displayName,
    default_currency: p.defaultCurrency,
    cycle_anchor_day: p.cycleAnchorDay,
    alert_threshold_pct: p.alertThresholdPct,
    onboarding_completed: p.onboardingCompleted,
  };
}

export function rowToProfile(r: any): Profile {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    defaultCurrency: r.default_currency,
    cycleAnchorDay: r.cycle_anchor_day,
    alertThresholdPct: Number(r.alert_threshold_pct),
    onboardingCompleted: r.onboarding_completed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function envelopeToRow(e: Envelope): Record<string, unknown> {
  return {
    id: e.id,
    user_id: e.userId,
    parent_id: e.parentId,
    name: e.name,
    color: e.color,
    icon: e.icon,
    allocated_amount: e.allocatedAmount,
    is_recurring: e.isRecurring,
    cycle_mode: e.cycleMode,
    cycle_anchor_day: e.cycleAnchorDay,
    alert_threshold_pct: e.alertThresholdPct,
    status: e.status,
    sort_order: e.sortOrder,
    archived_at: e.archivedAt,
  };
}

export function rowToEnvelope(r: any): Envelope {
  return {
    id: r.id,
    userId: r.user_id,
    parentId: r.parent_id,
    name: r.name,
    color: r.color,
    icon: r.icon,
    allocatedAmount: Number(r.allocated_amount),
    isRecurring: r.is_recurring,
    cycleMode: r.cycle_mode,
    cycleAnchorDay: r.cycle_anchor_day,
    alertThresholdPct: r.alert_threshold_pct === null ? null : Number(r.alert_threshold_pct),
    status: r.status,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

export function transactionToRow(t: Transaction): Record<string, unknown> {
  return {
    id: t.id,
    user_id: t.userId,
    envelope_id: t.envelopeId,
    amount: t.amount,
    type: t.type,
    occurred_at: t.occurredAt,
    description: t.description,
    recurrence_rule_id: t.recurrenceRuleId,
    deleted_at: t.deletedAt,
  };
}

export function rowToTransaction(r: any): Transaction {
  return {
    id: r.id,
    userId: r.user_id,
    envelopeId: r.envelope_id,
    amount: Number(r.amount),
    type: r.type,
    occurredAt: r.occurred_at,
    description: r.description,
    recurrenceRuleId: r.recurrence_rule_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

export function recurrenceRuleToRow(r: RecurrenceRule): Record<string, unknown> {
  return {
    id: r.id,
    user_id: r.userId,
    envelope_id: r.envelopeId,
    amount: r.amount,
    type: r.type,
    description: r.description,
    interval_value: r.intervalValue,
    interval_unit: r.intervalUnit,
    start_date: r.startDate,
    end_date: r.endDate,
    next_run_date: r.nextRunDate,
    status: r.status,
  };
}

export function rowToRecurrenceRule(r: any): RecurrenceRule {
  return {
    id: r.id,
    userId: r.user_id,
    envelopeId: r.envelope_id,
    amount: Number(r.amount),
    type: r.type,
    description: r.description,
    intervalValue: r.interval_value,
    intervalUnit: r.interval_unit,
    startDate: r.start_date,
    endDate: r.end_date,
    nextRunDate: r.next_run_date,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function pendingRecurrenceToRow(p: PendingRecurrence): Record<string, unknown> {
  return {
    id: p.id,
    user_id: p.userId,
    recurrence_rule_id: p.recurrenceRuleId,
    envelope_id: p.envelopeId,
    scheduled_date: p.scheduledDate,
    amount: p.amount,
    type: p.type,
    description: p.description,
    status: p.status,
    resolved_at: p.resolvedAt,
  };
}

export function rowToPendingRecurrence(r: any): PendingRecurrence {
  return {
    id: r.id,
    userId: r.user_id,
    recurrenceRuleId: r.recurrence_rule_id,
    envelopeId: r.envelope_id,
    scheduledDate: r.scheduled_date,
    amount: Number(r.amount),
    type: r.type,
    description: r.description,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

export function transferToRow(t: Transfer): Record<string, unknown> {
  return {
    id: t.id,
    user_id: t.userId,
    from_envelope_id: t.fromEnvelopeId,
    to_envelope_id: t.toEnvelopeId,
    amount: t.amount,
    note: t.note,
    occurred_at: t.occurredAt,
  };
}

export function rowToTransfer(r: any): Transfer {
  return {
    id: r.id,
    userId: r.user_id,
    fromEnvelopeId: r.from_envelope_id,
    toEnvelopeId: r.to_envelope_id,
    amount: Number(r.amount),
    note: r.note,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
  };
}

export function journalEventToRow(e: JournalEvent): Record<string, unknown> {
  return {
    id: e.id,
    user_id: e.userId,
    device_id: e.deviceId,
    event_type: e.eventType,
    entity_type: e.entityType,
    entity_id: e.entityId,
    payload: e.payload,
    inverse_payload: e.inversePayload,
    client_created_at: e.clientCreatedAt,
    is_undone: e.isUndone,
    undoes_event_id: e.undoesEventId,
    status: e.status,
    reject_reason: e.rejectReason ?? null,
  };
}

export function rowToJournalEvent(r: any): JournalEvent {
  return {
    id: r.id,
    userId: r.user_id,
    deviceId: r.device_id,
    seq: Number(r.seq),
    eventType: r.event_type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    payload: r.payload,
    inversePayload: r.inverse_payload,
    clientCreatedAt: r.client_created_at,
    receivedAt: r.received_at,
    isUndone: r.is_undone,
    undoesEventId: r.undoes_event_id,
    status: r.status,
    rejectReason: r.reject_reason,
  };
}
