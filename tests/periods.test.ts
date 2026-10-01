import { describe, it, expect } from "vitest";
import {
  computeDisponible,
  computeCarryOut,
  computeSoldeReel,
  computeClosedPeriods,
} from "@/lib/domain/periods";
import { buildEnvelopeTree } from "@/lib/domain/envelopes";
import { currentCycleStart, currentCycleEnd } from "@/lib/domain/recurrence";
import { convertMinorUnits } from "@/lib/domain/currency";
import type { Envelope, Transaction, Transfer } from "@/types/domain";

function cycleWindow(reference: Date, anchorDay: number) {
  return { start: currentCycleStart(reference, anchorDay), end: currentCycleEnd(reference, anchorDay) };
}

function makeEnvelope(overrides: Partial<Envelope>): Envelope {
  return {
    id: "id",
    userId: "u1",
    parentId: null,
    name: "Test",
    color: "#000",
    icon: "wallet",
    allocatedAmount: 5_000_000, // 50 000 (unité ×100)
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

function makeTx(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t",
    userId: "u1",
    envelopeId: "e1",
    amount: 100,
    type: "expense",
    occurredAt: "2026-01-05",
    description: null,
    recurrenceRuleId: null,
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function makeTransfer(overrides: Partial<Transfer>): Transfer {
  return {
    id: "tr",
    userId: "u1",
    fromEnvelopeId: "a",
    toEnvelopeId: "b",
    amount: 100,
    note: null,
    occurredAt: "2026-01-05",
    createdAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

// ============================================================================
// 1-3. Report d'un excédent / d'un déficit / disponible négatif
// ============================================================================

describe("computeDisponible / computeCarryOut — report de période", () => {
  it("reporte un excédent (50 000 alloués, 42 000 dépensés -> +8 000)", () => {
    const carryOut = computeCarryOut({
      allocatedAmount: 5_000_000,
      carryIn: 0,
      transfersIn: 0,
      transfersOut: 0,
      spent: 4_200_000,
    });
    expect(carryOut).toBe(800_000);
  });

  it("reporte un déficit (50 000 alloués, 60 000 dépensés -> -10 000)", () => {
    const carryOut = computeCarryOut({
      allocatedAmount: 5_000_000,
      carryIn: 0,
      transfersIn: 0,
      transfersOut: 0,
      spent: 6_000_000,
    });
    expect(carryOut).toBe(-1_000_000);
  });

  it("le disponible peut être négatif quand le déficit reporté dépasse l'alloué", () => {
    const disponible = computeDisponible({
      allocatedAmount: 5_000_000,
      carryIn: -6_000_000, // déficit reporté supérieur à l'alloué du cycle
      transfersIn: 0,
      transfersOut: 0,
      spent: 0,
    });
    expect(disponible).toBe(-1_000_000);
    expect(disponible).toBeLessThan(0);
  });
});

// ============================================================================
// 4-5. Enveloppe parent avec enfants / transaction directe sur un parent
// ============================================================================

describe("buildEnvelopeTree — arborescence et transaction directe sur un parent", () => {
  it("agrège le dépensé des enfants jusqu'à la racine, sans affecter l'allocation", () => {
    const root = makeEnvelope({ id: "root", parentId: null, allocatedAmount: 10_000_000 });
    const child = makeEnvelope({ id: "child", parentId: "root", allocatedAmount: 2_000_000 });
    const tx = makeTx({ envelopeId: "child", amount: 500_000, type: "expense" });

    const tree = buildEnvelopeTree({
      envelopes: [root, child],
      transactions: [tx],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });

    expect(tree?.subtreeSpent).toBe(500_000); // remonte à la racine
    expect(tree?.children[0]?.subtreeSpent).toBe(500_000);
    expect(tree?.allocatedToChildren).toBe(2_000_000); // n'a pas bougé
  });

  it("une transaction directe sur un noeud avec enfants compte dans son disponible propre", () => {
    const parent = makeEnvelope({ id: "p", parentId: null, allocatedAmount: 1_000_000 });
    const child = makeEnvelope({ id: "c", parentId: "p", allocatedAmount: 300_000 });
    // Rattachée directement au parent, pas à l'enfant (3.3 : autorisé même avec enfants).
    const tx = makeTx({ envelopeId: "p", amount: 100_000 });

    const tree = buildEnvelopeTree({
      envelopes: [parent, child],
      transactions: [tx],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });

    expect(tree?.directSpent).toBe(100_000);
    expect(tree?.availableForDirect).toBe(700_000); // 1 000 000 - 300 000 alloués à l'enfant
  });
});

// ============================================================================
// 6. Cycle personnalisé
// ============================================================================

describe("buildEnvelopeTree — cycle personnalisé", () => {
  it("une enveloppe avec cycleMode=custom utilise son propre jour d'ancrage, pas le global", () => {
    // Cycle global ancré le 1er, cycle personnalisé de l'enveloppe ancré le 25.
    // Le 5 janvier tombe dans le cycle global de janvier, mais dans le cycle personnalisé
    // qui a démarré le 25 décembre (mois précédent).
    const envelope = makeEnvelope({
      id: "e",
      cycleMode: "custom",
      cycleAnchorDay: 25,
      allocatedAmount: 1_000_000,
    });
    const txDec = makeTx({ id: "t1", envelopeId: "e", amount: 100_000, occurredAt: "2025-12-27" });
    const txJan = makeTx({ id: "t2", envelopeId: "e", amount: 200_000, occurredAt: "2026-01-02" });

    const tree = buildEnvelopeTree({
      envelopes: [envelope],
      transactions: [txDec, txJan],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1, // le cycle GLOBAL est calendaire, sans effet ici
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });

    // Les deux transactions tombent dans le cycle personnalisé [25 déc, 25 janv).
    expect(tree?.subtreeSpent).toBe(300_000);
  });
});

// ============================================================================
// 7 / 13. Transfert entre enveloppes — limité à la période, sans toucher l'alloué
// ============================================================================

describe("Transferts — n'affectent que la période en cours, jamais allocated_amount", () => {
  it("un transfert modifie le disponible des deux enveloppes sans changer leur montant alloué", () => {
    const a = makeEnvelope({ id: "a", allocatedAmount: 1_000_000 });
    const b = makeEnvelope({ id: "b", allocatedAmount: 500_000 });
    const transfer = makeTransfer({ fromEnvelopeId: "a", toEnvelopeId: "b", amount: 200_000, occurredAt: "2026-01-10" });

    // Chaque enveloppe est testée isolément (buildEnvelopeTree exige une racine unique).
    const treeA = buildEnvelopeTree({
      envelopes: [{ ...a, parentId: null }],
      transactions: [],
      transfers: [transfer],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-15T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });
    const treeB = buildEnvelopeTree({
      envelopes: [{ ...b, parentId: null }],
      transactions: [],
      transfers: [transfer],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-15T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });

    expect(treeA?.transfersOut).toBe(200_000);
    expect(treeA?.remaining).toBe(800_000); // 1 000 000 - 200 000, allocated_amount inchangé
    expect(treeA?.envelope.allocatedAmount).toBe(1_000_000);

    expect(treeB?.transfersIn).toBe(200_000);
    expect(treeB?.remaining).toBe(700_000); // 500 000 + 200 000
    expect(treeB?.envelope.allocatedAmount).toBe(500_000);
  });

  it("un transfert d'une période ne se répercute PAS sur la période suivante (sauf via le report)", () => {
    const build = (transferAmount: number) =>
      computeClosedPeriods({
        envelopeCreatedAt: new Date("2025-11-01T00:00:00.000Z"),
        allocatedAmount: 1_000_000,
        anchorDay: 1,
        now: new Date("2026-02-01T00:00:00.000Z"), // 3 cycles complets : nov, déc, janv
        cycleWindow,
        spentInWindow: () => 0,
        transfersInWindow: (start) => {
          // Un seul transfert entrant, uniquement en décembre.
          const isDecember = start.getUTCMonth() === 11;
          return { transfersIn: isDecember ? transferAmount : 0, transfersOut: 0 };
        },
      });

    const withoutTransfer = build(0);
    const withTransfer = build(200_000);

    const decWithout = withoutTransfer.find((p) => p.cycleStart === "2025-12-01")!;
    const decWith = withTransfer.find((p) => p.cycleStart === "2025-12-01")!;
    const janWithout = withoutTransfer.find((p) => p.cycleStart === "2026-01-01")!;
    const janWith = withTransfer.find((p) => p.cycleStart === "2026-01-01")!;

    expect(decWith.transfersIn).toBe(200_000);
    expect(janWith.transfersIn).toBe(0); // pas de nouvel effet direct du transfert en janvier
    // Le transfert augmente exactement de 200 000 le carryOut de décembre...
    expect(decWith.carryOut).toBe(decWithout.carryOut + 200_000);
    // ...et cet écart de 200 000 se propage tel quel à janvier, mais UNIQUEMENT via le
    // report (carryIn), jamais comme un nouveau transfert de cette période.
    expect(janWith.carryIn).toBe(janWithout.carryIn + 200_000);
    expect(janWith.carryOut).toBe(janWithout.carryOut + 200_000);
  });
});

// ============================================================================
// 8. Transaction en attente — ne compte pas tant qu'elle n'est pas confirmée
// ============================================================================

describe("Transactions en attente (4.2)", () => {
  it("une échéance en attente de confirmation ne compte pas dans le dépensé", () => {
    const envelope = makeEnvelope({ id: "e", allocatedAmount: 1_000_000 });
    // Aucune transaction réelle n'existe encore : l'échéance vit dans `pending_recurrences`,
    // une table distincte de `transactions`, donc absente de la liste passée ici.
    const tree = buildEnvelopeTree({
      envelopes: [envelope],
      transactions: [],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });
    expect(tree?.subtreeSpent).toBe(0);
    expect(tree?.remaining).toBe(1_000_000);
  });
});

// ============================================================================
// 9. Modification rétroactive dans une période déjà clôturée
// ============================================================================

describe("Recalcul en cascade après modification rétroactive", () => {
  it("ajouter une dépense dans un cycle déjà clos recalcule son report ET celui des cycles suivants", () => {
    const buildWithSpentInDecember = (decemberSpent: number) =>
      computeClosedPeriods({
        envelopeCreatedAt: new Date("2025-11-01T00:00:00.000Z"),
        allocatedAmount: 1_000_000,
        anchorDay: 1,
        now: new Date("2026-02-01T00:00:00.000Z"),
        cycleWindow,
        spentInWindow: (start) => (start.getUTCMonth() === 11 ? decemberSpent : 0),
        transfersInWindow: () => ({ transfersIn: 0, transfersOut: 0 }),
      });

    const before = buildWithSpentInDecember(0);
    const after = buildWithSpentInDecember(300_000); // une dépense de 300 000 ajoutée après coup

    const decBefore = before.find((p) => p.cycleStart === "2025-12-01")!;
    const decAfter = after.find((p) => p.cycleStart === "2025-12-01")!;
    const janBefore = before.find((p) => p.cycleStart === "2026-01-01")!;
    const janAfter = after.find((p) => p.cycleStart === "2026-01-01")!;

    expect(decAfter.carryOut).toBe(decBefore.carryOut - 300_000);
    // Le report de janvier (carryIn) suit exactement le nouveau carryOut de décembre :
    // c'est la cascade demandée, pas seulement la période modifiée.
    expect(janAfter.carryIn).toBe(decAfter.carryOut);
    expect(janAfter.carryOut).toBe(janBefore.carryOut - 300_000);
  });
});

// ============================================================================
// 10. Archivage — arrête la chaîne de reports
// ============================================================================

describe("Archivage (3.5)", () => {
  it("une enveloppe archivée est exclue de l'arbre actif et de l'agrégation du parent", () => {
    const root = makeEnvelope({ id: "root", allocatedAmount: 1_000_000 });
    const archived = makeEnvelope({
      id: "child",
      parentId: "root",
      allocatedAmount: 200_000,
      status: "archived",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    const tx = makeTx({ envelopeId: "child", amount: 50_000 });

    const tree = buildEnvelopeTree({
      envelopes: [root, archived],
      transactions: [tx],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });

    expect(tree?.children).toHaveLength(0); // enfant archivé exclu de l'arbre actif
    expect(tree?.allocatedToChildren).toBe(0);
    expect(tree?.subtreeSpent).toBe(0); // sa dépense ne remonte plus au parent
  });
});

// ============================================================================
// 11. Dépenses hors budget — bascule dans les deux sens
// ============================================================================

describe("Dépenses hors budget (rattachement/détachement)", () => {
  it("une transaction sans enveloppe ne compte dans le dépensé d'aucune enveloppe", () => {
    const envelope = makeEnvelope({ id: "e", allocatedAmount: 1_000_000 });
    const outOfBudget = makeTx({ envelopeId: null, amount: 400_000 });

    const tree = buildEnvelopeTree({
      envelopes: [envelope],
      transactions: [outOfBudget],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });
    expect(tree?.subtreeSpent).toBe(0);
  });

  it("rattacher ensuite cette dépense à l'enveloppe la fait compter dans son dépensé", () => {
    const envelope = makeEnvelope({ id: "e", allocatedAmount: 1_000_000 });
    const nowAttached = makeTx({ envelopeId: "e", amount: 400_000 });

    const tree = buildEnvelopeTree({
      envelopes: [envelope],
      transactions: [nowAttached],
      transfers: [],
      carryInByEnvelope: new Map(),
      globalCycleAnchorDay: 1,
      today: new Date("2026-01-05T00:00:00.000Z"),
      defaultThresholdPct: 80,
    });
    expect(tree?.subtreeSpent).toBe(400_000);
  });
});

// ============================================================================
// 12 / 14. Solde réel, y compris les remboursements
// ============================================================================

describe("computeSoldeReel", () => {
  it("solde réel = rentrées - (dépenses - remboursements)", () => {
    const solde = computeSoldeReel({
      incomeEntriesTotal: 10_000_000, // 100 000 de rentrées
      expenseTotal: 6_000_000, // 60 000 de dépenses (dont hors budget)
      reimbursementTotal: 1_000_000, // 10 000 remboursés par un tiers
    });
    // 100 000 - (60 000 - 10 000) = 50 000
    expect(solde).toBe(5_000_000);
  });

  it("un remboursement réduit l'impact des dépenses sur le solde réel sans être une rentrée", () => {
    const sansRemboursement = computeSoldeReel({
      incomeEntriesTotal: 0,
      expenseTotal: 1_000_000,
      reimbursementTotal: 0,
    });
    const avecRemboursement = computeSoldeReel({
      incomeEntriesTotal: 0,
      expenseTotal: 1_000_000,
      reimbursementTotal: 1_000_000,
    });
    expect(sansRemboursement).toBe(-1_000_000);
    expect(avecRemboursement).toBe(0); // entièrement remboursée : impact neutre
  });
});

// ============================================================================
// 15. Conversion de devise sans dérive d'arrondi
// ============================================================================

describe("convertMinorUnits — arrondi unique centralisé", () => {
  it("convertit sans perdre la précision grâce au stockage ×100 (50 000 XOF ~ 76,22 EUR)", () => {
    // Taux fictif proche d'un taux XOF->EUR réaliste.
    const rate = 0.0015244;
    const fiftyThousandXof = 5_000_000; // 50 000 × 100
    const converted = convertMinorUnits(fiftyThousandXof, rate);
    expect(converted).toBe(7622); // 76,22 EUR × 100, arrondi une seule fois
  });

  it("un aller-retour de conversion n'accumule pas de dérive au-delà de l'arrondi attendu", () => {
    const original = 5_000_000;
    const toEur = convertMinorUnits(original, 0.0015244);
    const backToXof = convertMinorUnits(toEur, 1 / 0.0015244);
    // L'arrondi entier ×100 introduit un écart marginal inévitable (sous-unité), jamais
    // une dérive importante : on tolère quelques unités ×100 (soit quelques centimes).
    expect(Math.abs(backToXof - original)).toBeLessThan(500);
  });
});

// ============================================================================
// 16. Clôture en rattrapage de plusieurs périodes manquées
// ============================================================================

describe("Clôture en rattrapage (idempotence et enchaînement)", () => {
  it("clôture d'un coup plusieurs cycles jamais traités, dans l'ordre, en chaînant le report", () => {
    const periods = computeClosedPeriods({
      envelopeCreatedAt: new Date("2025-10-01T00:00:00.000Z"),
      allocatedAmount: 1_000_000,
      anchorDay: 1,
      now: new Date("2026-02-01T00:00:00.000Z"), // 4 cycles jamais clos : oct, nov, déc, janv
      cycleWindow,
      spentInWindow: (start) => (start.getUTCMonth() === 9 ? 200_000 : 100_000), // octobre différent
      transfersInWindow: () => ({ transfersIn: 0, transfersOut: 0 }),
    });

    expect(periods).toHaveLength(4);
    expect(periods.map((p) => p.cycleStart)).toEqual([
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
    ]);

    // Chaîne de report correcte cycle après cycle.
    expect(periods[0]!.carryIn).toBe(0);
    expect(periods[0]!.carryOut).toBe(800_000); // 1 000 000 - 200 000
    expect(periods[1]!.carryIn).toBe(800_000);
    expect(periods[1]!.carryOut).toBe(1_700_000); // 800 000 + 1 000 000 - 100 000
    expect(periods[2]!.carryIn).toBe(1_700_000);
    expect(periods[3]!.carryIn).toBe(periods[2]!.carryOut);
  });

  it("n'inclut jamais la période en cours (non close)", () => {
    const periods = computeClosedPeriods({
      envelopeCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      allocatedAmount: 1_000_000,
      anchorDay: 1,
      now: new Date("2026-01-15T00:00:00.000Z"), // toujours dans le cycle de janvier
      cycleWindow,
      spentInWindow: () => 0,
      transfersInWindow: () => ({ transfersIn: 0, transfersOut: 0 }),
    });
    expect(periods).toHaveLength(0);
  });
});
