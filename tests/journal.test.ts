import { describe, it, expect } from "vitest";
import { assertIsMostRecent, computeUndoSteps, findMostRecentUndoable, UndoError } from "@/lib/domain/journal";
import type { JournalEvent } from "@/types/domain";

function makeEvent(overrides: Partial<JournalEvent>): JournalEvent {
  return {
    id: "e1",
    userId: "u1",
    deviceId: "d1",
    eventType: "envelope.create",
    entityType: "envelope",
    entityId: "env1",
    payload: {},
    inversePayload: null,
    clientCreatedAt: "2026-01-01T00:00:00.000Z",
    isUndone: false,
    undoesEventId: null,
    status: "applied",
    ...overrides,
  };
}

describe("undo — ne porte que sur la toute dernière action (section 5)", () => {
  it("interdit d'annuler autre chose que le dernier événement", () => {
    const older = makeEvent({ id: "e1", clientCreatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeEvent({ id: "e2", clientCreatedAt: "2026-01-02T00:00:00.000Z" });
    expect(() => assertIsMostRecent(older, [older, newer])).toThrow(UndoError);
    expect(() => assertIsMostRecent(newer, [older, newer])).not.toThrow();
  });

  it("findMostRecentUndoable ignore les événements déjà annulés", () => {
    const older = makeEvent({ id: "e1", clientCreatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeEvent({ id: "e2", clientCreatedAt: "2026-01-02T00:00:00.000Z", isUndone: true });
    const result = findMostRecentUndoable([older, newer]);
    expect(result?.id).toBe("e1");
  });

  it("n'a rien à annuler si tout est déjà annulé", () => {
    const e = makeEvent({ isUndone: true });
    expect(findMostRecentUndoable([e])).toBeNull();
  });
});

describe("computeUndoSteps", () => {
  it("envelope.create s'annule par une suppression", () => {
    const event = makeEvent({ eventType: "envelope.create", entityId: "env1" });
    const steps = computeUndoSteps(event);
    expect(steps).toEqual([{ table: "envelopes", op: "delete", id: "env1" }]);
  });

  it("envelope.update restaure les valeurs précédentes (inversePayload)", () => {
    const event = makeEvent({
      eventType: "envelope.update",
      entityId: "env1",
      payload: { allocatedAmount: 500 },
      inversePayload: { allocatedAmount: 300 },
    });
    const steps = computeUndoSteps(event);
    expect(steps).toEqual([
      { table: "envelopes", op: "upsert", id: "env1", data: { allocatedAmount: 300 } },
    ]);
  });

  it("transfer.create s'annule par une simple suppression (n'a jamais touché allocated_amount)", () => {
    const event = makeEvent({
      eventType: "transfer.create",
      entityType: "transfer",
      entityId: "tr1",
      payload: {
        fromEnvelopeId: "a",
        toEnvelopeId: "b",
        amount: 100,
        occurredAt: "2026-01-01",
      },
    });
    const steps = computeUndoSteps(event);
    expect(steps).toEqual([{ table: "transfers", op: "delete", id: "tr1" }]);
  });

  it("pending_recurrence.confirm supprime la transaction créée et rouvre l'échéance", () => {
    const event = makeEvent({
      eventType: "pending_recurrence.confirm",
      entityType: "pending_recurrence",
      entityId: "p1",
      payload: { createdTransactionId: "tx1" },
    });
    const steps = computeUndoSteps(event);
    expect(steps).toContainEqual({ table: "transactions", op: "delete", id: "tx1" });
    expect(steps).toContainEqual({
      table: "pending_recurrences",
      op: "upsert",
      id: "p1",
      data: { status: "awaiting_confirmation", resolvedAt: null },
    });
  });
});
