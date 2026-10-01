import { describe, it, expect } from "vitest";
import {
  assertAllocationFits,
  assertNewAmountCoversChildren,
  AllocationError,
  availableForDirectTransactions,
  buildEnvelopeTree,
} from "@/lib/domain/envelopes";
import type { Envelope, Transaction } from "@/types/domain";

function makeEnvelope(overrides: Partial<Envelope>): Envelope {
  return {
    id: "id",
    userId: "u1",
    parentId: null,
    name: "Test",
    color: "#000",
    icon: "wallet",
    allocatedAmount: 100,
    isRecurring: true,
    cycleMode: "inherit",
    cycleAnchorDay: null,
    alertThresholdPct: null,
    status: "active",
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

describe("assertAllocationFits (3.3)", () => {
  it("autorise une répartition qui ne dépasse pas le parent", () => {
    const parent = makeEnvelope({ id: "root", allocatedAmount: 1000 });
    const siblings = [makeEnvelope({ id: "a", allocatedAmount: 300 })];
    expect(() => assertAllocationFits(siblings, 400, parent)).not.toThrow();
  });

  it("bloque une répartition qui dépasserait le parent", () => {
    const parent = makeEnvelope({ id: "root", allocatedAmount: 1000 });
    const siblings = [makeEnvelope({ id: "a", allocatedAmount: 800 })];
    expect(() => assertAllocationFits(siblings, 300, parent)).toThrow(AllocationError);
  });

  it("ne contraint rien pour la racine (pas de parent)", () => {
    expect(() => assertAllocationFits([], 999999, undefined)).not.toThrow();
  });
});

describe("assertNewAmountCoversChildren", () => {
  it("bloque une réduction en dessous de ce qui est déjà réparti aux enfants", () => {
    const children = [makeEnvelope({ allocatedAmount: 600 })];
    expect(() => assertNewAmountCoversChildren(children, 500)).toThrow(AllocationError);
  });

  it("autorise une réduction qui reste suffisante", () => {
    const children = [makeEnvelope({ allocatedAmount: 400 })];
    expect(() => assertNewAmountCoversChildren(children, 500)).not.toThrow();
  });
});

describe("availableForDirectTransactions (3.3, 2e règle)", () => {
  it("soustrait ce qui est alloué aux enfants du montant du noeud", () => {
    const parent = makeEnvelope({ allocatedAmount: 1000 });
    const children = [makeEnvelope({ allocatedAmount: 300 }), makeEnvelope({ allocatedAmount: 200 })];
    expect(availableForDirectTransactions(parent, children)).toBe(500);
  });
});

describe("buildEnvelopeTree", () => {
  it("calcule le consommé/restant en cascade jusqu'à la racine", () => {
    const root = makeEnvelope({ id: "root", parentId: null, allocatedAmount: 1000 });
    const loisirs = makeEnvelope({ id: "loisirs", parentId: "root", allocatedAmount: 200 });
    const envelopes = [root, loisirs];

    const tx: Transaction = {
      id: "t1",
      userId: "u1",
      envelopeId: "loisirs",
      amount: 50,
      type: "expense",
      occurredAt: "2026-01-05",
      description: null,
      recurrenceRuleId: null,
      createdAt: "2026-01-05T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
      deletedAt: null,
    };
    const tree = buildEnvelopeTree({
      envelopes,
      transactions: [tx],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });
    expect(tree?.subtreeSpent).toBe(50); // remonte jusqu'à la racine
    expect(tree?.children[0]?.subtreeSpent).toBe(50);
    expect(tree?.children[0]?.remaining).toBe(150);
  });

  it("marque un dépassement quand les dépenses excèdent le montant alloué", () => {
    const root = makeEnvelope({ id: "root", allocatedAmount: 100 });
    const tx: Transaction = {
      id: "t1",
      userId: "u1",
      envelopeId: "root",
      amount: 150,
      type: "expense",
      occurredAt: "2026-01-05",
      description: null,
      recurrenceRuleId: null,
      createdAt: "2026-01-05T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
      deletedAt: null,
    };
    const tree = buildEnvelopeTree({
      envelopes: [root],
      transactions: [tx],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });
    expect(tree?.isOverBudget).toBe(true);
  });
});
