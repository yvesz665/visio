/**
 * Journal d'activité et annulation (section 5 du cahier des charges).
 *
 * Principe clé qui simplifie tout le reste : l'annulation ne porte JAMAIS que sur
 * l'action la plus récente (localement ou tous appareils confondus une fois synchronisé).
 * Comme on interdit d'annuler autre chose que le tout dernier événement non annulé,
 * il est structurellement impossible qu'une action plus récente dépende encore de celle
 * qu'on annule -- exactement la garantie que demande le cahier des charges ("cela évite
 * les conflits"). Il n'y a donc pas de vérification de dépendance à faire au cas par cas :
 * une seule règle d'ordre suffit.
 *
 * Ce module ne touche à aucune base de données : il calcule, à partir d'un événement et
 * de son `inversePayload` (capturé au moment où l'action a été faite), la liste des
 * mutations à appliquer pour revenir à l'état précédent. La couche de persistance
 * (Dexie côté client, route /api/sync côté serveur) se charge d'exécuter ce plan.
 */

import type { JournalEntityType, JournalEvent } from "@/types/domain";

export interface UndoStep {
  table:
    | "envelopes"
    | "transactions"
    | "recurrence_rules"
    | "pending_recurrences"
    | "transfers"
    | "profiles";
  op: "upsert" | "delete";
  id: string;
  data?: Record<string, unknown>;
}

export class UndoError extends Error {
  code: "not_most_recent" | "nothing_to_undo" | "unsupported_event";
  constructor(code: UndoError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "UndoError";
  }
}

/** Clé d'ordre chronologique d'un événement : seq serveur si connu, sinon horodatage client. */
function orderKey(event: Pick<JournalEvent, "seq" | "clientCreatedAt">): number {
  return event.seq ?? new Date(event.clientCreatedAt).getTime();
}

/**
 * Vérifie que `event` est bien le dernier événement non annulé de l'utilisateur.
 * `allEvents` doit contenir tous les événements connus localement (déjà synchronisés
 * ou non), appliqués (`status === "applied"`).
 */
export function assertIsMostRecent(event: JournalEvent, allEvents: JournalEvent[]): void {
  const applied = allEvents.filter((e) => e.status === "applied" && !e.isUndone);
  if (applied.length === 0) {
    throw new UndoError("nothing_to_undo", "Aucune action à annuler.");
  }
  const mostRecent = applied.reduce((a, b) => (orderKey(a) >= orderKey(b) ? a : b));
  if (mostRecent.id !== event.id) {
    throw new UndoError(
      "not_most_recent",
      "Seule la dernière action peut être annulée ; annulez d'abord les actions plus récentes."
    );
  }
}

/** Renvoie le dernier événement annulable, ou null s'il n'y en a pas. */
export function findMostRecentUndoable(allEvents: JournalEvent[]): JournalEvent | null {
  const applied = allEvents.filter((e) => e.status === "applied" && !e.isUndone);
  if (applied.length === 0) return null;
  return applied.reduce((a, b) => (orderKey(a) >= orderKey(b) ? a : b));
}

/**
 * Calcule le plan d'annulation pour un événement donné. `event.inversePayload` doit
 * avoir été renseigné au moment de la création de l'événement (voir producers dans
 * src/lib/sync/events.ts) : soit un instantané "avant" des champs modifiés, soit une
 * marque explicite selon le type d'action.
 */
export function computeUndoSteps(event: JournalEvent): UndoStep[] {
  const { eventType, entityId, payload, inversePayload } = event;

  switch (eventType) {
    // --- Enveloppes -----------------------------------------------------
    case "envelope.create":
      return [{ table: "envelopes", op: "delete", id: entityId }];

    case "envelope.update":
      return [{ table: "envelopes", op: "upsert", id: entityId, data: inversePayload ?? {} }];

    case "envelope.archive":
      return [
        {
          table: "envelopes",
          op: "upsert",
          id: entityId,
          data: { status: "active", archivedAt: null },
        },
      ];

    case "envelope.delete":
      return [{ table: "envelopes", op: "upsert", id: entityId, data: inversePayload ?? {} }];

    // --- Transactions -----------------------------------------------------
    case "transaction.create":
      return [{ table: "transactions", op: "delete", id: entityId }];

    case "transaction.update":
      return [{ table: "transactions", op: "upsert", id: entityId, data: inversePayload ?? {} }];

    case "transaction.delete":
      return [{ table: "transactions", op: "upsert", id: entityId, data: inversePayload ?? {} }];

    // --- Transferts -------------------------------------------------------
    case "transfer.create": {
      const fromId = payload.fromEnvelopeId as string;
      const toId = payload.toEnvelopeId as string;
      const fromPrev = payload.fromAllocatedBefore as number;
      const toPrev = payload.toAllocatedBefore as number;
      return [
        { table: "envelopes", op: "upsert", id: fromId, data: { allocatedAmount: fromPrev } },
        { table: "envelopes", op: "upsert", id: toId, data: { allocatedAmount: toPrev } },
        { table: "transfers", op: "delete", id: entityId },
      ];
    }

    // --- Récurrences --------------------------------------------------------
    case "recurrence.create":
      return [{ table: "recurrence_rules", op: "delete", id: entityId }];

    case "recurrence.update":
      return [
        { table: "recurrence_rules", op: "upsert", id: entityId, data: inversePayload ?? {} },
      ];

    case "recurrence.delete":
      return [
        { table: "recurrence_rules", op: "upsert", id: entityId, data: inversePayload ?? {} },
      ];

    case "pending_recurrence.confirm": {
      const createdTransactionId = payload.createdTransactionId as string;
      return [
        { table: "transactions", op: "delete", id: createdTransactionId },
        {
          table: "pending_recurrences",
          op: "upsert",
          id: entityId,
          data: { status: "awaiting_confirmation", resolvedAt: null },
        },
      ];
    }

    case "pending_recurrence.dismiss":
      return [
        {
          table: "pending_recurrences",
          op: "upsert",
          id: entityId,
          data: { status: "awaiting_confirmation", resolvedAt: null },
        },
      ];

    // --- Profil / devise ----------------------------------------------------
    case "profile.currency_change": {
      const steps: UndoStep[] = [
        {
          table: "profiles",
          op: "upsert",
          id: entityId,
          data: { defaultCurrency: inversePayload?.previousCurrency },
        },
      ];
      const prevEnvelopeAmounts =
        (inversePayload?.envelopeAllocations as Record<string, number>) ?? {};
      const prevTransactionAmounts =
        (inversePayload?.transactionAmounts as Record<string, number>) ?? {};
      const prevRecurrenceAmounts =
        (inversePayload?.recurrenceAmounts as Record<string, number>) ?? {};
      for (const [id, allocatedAmount] of Object.entries(prevEnvelopeAmounts)) {
        steps.push({ table: "envelopes", op: "upsert", id, data: { allocatedAmount } });
      }
      for (const [id, amount] of Object.entries(prevTransactionAmounts)) {
        steps.push({ table: "transactions", op: "upsert", id, data: { amount } });
      }
      for (const [id, amount] of Object.entries(prevRecurrenceAmounts)) {
        steps.push({ table: "recurrence_rules", op: "upsert", id, data: { amount } });
      }
      return steps;
    }

    case "profile.update":
      return [{ table: "profiles", op: "upsert", id: entityId, data: inversePayload ?? {} }];

    default:
      throw new UndoError("unsupported_event", `Type d'événement non pris en charge: ${eventType}`);
  }
}

/** Type de l'entité concernée par un plan d'annulation, pour rafraîchir le bon cache local. */
export function affectedEntityTypes(steps: UndoStep[]): JournalEntityType[] {
  const map: Record<UndoStep["table"], JournalEntityType> = {
    envelopes: "envelope",
    transactions: "transaction",
    recurrence_rules: "recurrence_rule",
    pending_recurrences: "pending_recurrence",
    transfers: "transfer",
    profiles: "profile",
  };
  return Array.from(new Set(steps.map((s) => map[s.table])));
}
