/**
 * Logique métier pure autour de l'arborescence de budgets (section 3 du cahier des charges).
 * Ce module ne dépend d'aucune infrastructure (pas de Dexie, pas de Supabase) afin de pouvoir
 * être exécuté aussi bien côté client (feedback instantané hors-ligne) que côté serveur
 * (revalidation à la synchronisation) et testé unitairement.
 */

import type { Envelope, EnvelopeSummary, Transaction, Transfer } from "@/types/domain";
import { currentCycleEnd, currentCycleStart, isWithinCycle } from "./recurrence";
import { computeDisponible, computePercentConsumed } from "./periods";

export class AllocationError extends Error {
  code: "allocation_exceeds_parent" | "allocation_exceeds_new_amount" | "root_immutable_parent" | "not_empty";
  constructor(code: AllocationError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "AllocationError";
  }
}

/**
 * Vérifie la règle d'allocation (3.3) : la somme des enveloppes actives enfants d'un
 * noeud ne peut jamais dépasser le montant alloué à ce noeud parent.
 *
 * @param siblings enveloppes actives déjà existantes sous le même parent (sans le candidat)
 * @param candidateAmount montant alloué du candidat (nouvelle enveloppe, ou nouveau montant)
 * @param parent enveloppe parente (undefined si on crée/modifie la racine)
 */
export function assertAllocationFits(
  siblings: Pick<Envelope, "allocatedAmount">[],
  candidateAmount: number,
  parent: Pick<Envelope, "allocatedAmount"> | undefined
): void {
  if (!parent) return; // la racine n'a pas de parent, aucune contrainte de ce type
  const siblingsSum = siblings.reduce((sum, e) => sum + e.allocatedAmount, 0);
  const total = siblingsSum + candidateAmount;
  if (total > parent.allocatedAmount) {
    throw new AllocationError(
      "allocation_exceeds_parent",
      `La somme des enveloppes (${total}) dépasserait le montant alloué au parent (${parent.allocatedAmount}).`
    );
  }
}

/**
 * Vérifie qu'en réduisant le montant alloué d'un noeud, ce nouveau montant reste
 * suffisant pour couvrir ce qui est déjà réparti à ses propres enfants actifs.
 */
export function assertNewAmountCoversChildren(
  activeChildren: Pick<Envelope, "allocatedAmount">[],
  newAmount: number
): void {
  const childrenSum = activeChildren.reduce((sum, e) => sum + e.allocatedAmount, 0);
  if (childrenSum > newAmount) {
    throw new AllocationError(
      "allocation_exceeds_new_amount",
      `Le nouveau montant (${newAmount}) est inférieur à ce qui est déjà réparti aux enfants (${childrenSum}).`
    );
  }
}

/** Montant disponible pour des transactions directes sur ce noeud (3.3, 2e règle). */
export function availableForDirectTransactions(
  envelope: Pick<Envelope, "allocatedAmount">,
  activeChildren: Pick<Envelope, "allocatedAmount">[]
): number {
  const allocatedToChildren = activeChildren.reduce((sum, e) => sum + e.allocatedAmount, 0);
  return envelope.allocatedAmount - allocatedToChildren;
}

/** Une enveloppe ne peut être supprimée définitivement que si elle est vide (3.5). */
export function canHardDelete(hasTransactions: boolean, hasChildren: boolean): boolean {
  return !hasTransactions && !hasChildren;
}

export interface BuildEnvelopeTreeParams {
  envelopes: Envelope[];
  /** Non filtrées : chaque noeud résout sa propre fenêtre de cycle (custom ou héritée). */
  transactions: Transaction[];
  transfers: Transfer[];
  /** Report reçu par enveloppe, issu de sa dernière période close (0 si absente). */
  carryInByEnvelope: Map<string, number>;
  globalCycleAnchorDay: number;
  /** "Aujourd'hui", déjà résolu dans le fuseau de l'utilisateur (voir todayInTimeZone). */
  today: Date;
  defaultThresholdPct: number;
  /** Ids dont le calcul s'appuie sur des mutations locales pas encore synchronisées (10.2). */
  provisionalEnvelopeIds?: Set<string>;
}

/**
 * Construit l'arborescence de résumés (report, disponible, alertes) à partir d'une
 * liste plate d'enveloppes. Chaque noeud résout sa propre fenêtre de cycle (3.4 : cycle
 * global ou personnalisé) ; une enveloppe non récurrente n'a ni fenêtre ni report, elle
 * agrège tout son historique (elle se clôture par archivage, pas par cycle).
 */
export function buildEnvelopeTree(params: BuildEnvelopeTreeParams): EnvelopeSummary | null {
  const {
    envelopes,
    transactions,
    transfers,
    carryInByEnvelope,
    globalCycleAnchorDay,
    today,
    defaultThresholdPct,
    provisionalEnvelopeIds,
  } = params;

  const byParent = new Map<string | null, Envelope[]>();
  for (const env of envelopes) {
    const key = env.parentId;
    const list = byParent.get(key) ?? [];
    list.push(env);
    byParent.set(key, list);
  }

  const root = envelopes.find((e) => e.parentId === null);
  if (!root) return null;

  function resolveWindow(envelope: Envelope): { start: Date; end: Date } | null {
    if (!envelope.isRecurring) return null; // pas de fenêtre : agrège tout l'historique
    const anchorDay =
      envelope.cycleMode === "custom" && envelope.cycleAnchorDay
        ? envelope.cycleAnchorDay
        : globalCycleAnchorDay;
    return { start: currentCycleStart(today, anchorDay), end: currentCycleEnd(today, anchorDay) };
  }

  function inWindow(date: string, window: { start: Date; end: Date } | null): boolean {
    if (!window) return true; // pas de fenêtre = tout l'historique compte
    return isWithinCycle(new Date(`${date}T00:00:00Z`), window.start, window.end);
  }

  function computeDirectSpent(envelopeId: string, window: { start: Date; end: Date } | null): number {
    let sum = 0;
    for (const t of transactions) {
      if (t.deletedAt || t.envelopeId !== envelopeId) continue;
      if (!inWindow(t.occurredAt, window)) continue;
      sum += t.type === "expense" ? t.amount : -t.amount; // "income" ici = remboursement
    }
    return sum;
  }

  function computeTransfers(
    envelopeId: string,
    window: { start: Date; end: Date } | null
  ): { transfersIn: number; transfersOut: number } {
    let transfersIn = 0;
    let transfersOut = 0;
    for (const tr of transfers) {
      if (!inWindow(tr.occurredAt.slice(0, 10), window)) continue;
      if (tr.toEnvelopeId === envelopeId) transfersIn += tr.amount;
      if (tr.fromEnvelopeId === envelopeId) transfersOut += tr.amount;
    }
    return { transfersIn, transfersOut };
  }

  function build(envelope: Envelope): EnvelopeSummary {
    const childEnvelopes = (byParent.get(envelope.id) ?? [])
      .filter((e) => e.status === "active")
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const children = childEnvelopes.map(build);
    const window = resolveWindow(envelope);
    const directSpent = computeDirectSpent(envelope.id, window);
    const subtreeSpent = directSpent + children.reduce((s, c) => s + c.subtreeSpent, 0);
    const allocatedToChildren = childEnvelopes.reduce((s, e) => s + e.allocatedAmount, 0);
    const threshold = envelope.alertThresholdPct ?? defaultThresholdPct;

    const carryIn = envelope.isRecurring ? (carryInByEnvelope.get(envelope.id) ?? 0) : 0;
    const { transfersIn, transfersOut } = envelope.isRecurring
      ? computeTransfers(envelope.id, window)
      : { transfersIn: 0, transfersOut: 0 };

    const remaining = computeDisponible({
      allocatedAmount: envelope.allocatedAmount,
      carryIn,
      transfersIn,
      transfersOut,
      spent: subtreeSpent,
    });
    const percentConsumed = computePercentConsumed(subtreeSpent, envelope.allocatedAmount);

    // "provisoire" hérité : si un descendant a des mutations locales non synchronisées,
    // le disponible agrégé de tous ses ancêtres l'est aussi.
    const isProvisional =
      (provisionalEnvelopeIds?.has(envelope.id) ?? false) || children.some((c) => c.isProvisional);

    return {
      envelope,
      children,
      directSpent,
      subtreeSpent,
      allocatedToChildren,
      availableForDirect: envelope.allocatedAmount - allocatedToChildren,
      carryIn,
      transfersIn,
      transfersOut,
      remaining,
      percentConsumed,
      isOverBudget: remaining < 0,
      isNearThreshold: percentConsumed >= threshold && percentConsumed < 100,
      isProvisional,
      cycleStart: window ? window.start.toISOString().slice(0, 10) : null,
      cycleEnd: window ? window.end.toISOString().slice(0, 10) : null,
    };
  }

  return build(root);
}

/** Aplati un arbre de résumés en liste (parcours pré-ordre), utile pour les listes/tableaux. */
export function flattenSummary(summary: EnvelopeSummary): EnvelopeSummary[] {
  return [summary, ...summary.children.flatMap(flattenSummary)];
}

/** Retrouve le résumé d'une enveloppe précise dans l'arbre par son id. */
export function findSummaryById(root: EnvelopeSummary, id: string): EnvelopeSummary | null {
  if (root.envelope.id === id) return root;
  for (const child of root.children) {
    const found = findSummaryById(child, id);
    if (found) return found;
  }
  return null;
}

/** Renvoie tous les ancêtres d'une enveloppe (du parent direct jusqu'à la racine). */
export function getAncestors(envelope: Envelope, allEnvelopes: Envelope[]): Envelope[] {
  const byId = new Map(allEnvelopes.map((e) => [e.id, e]));
  const ancestors: Envelope[] = [];
  let current = envelope.parentId ? byId.get(envelope.parentId) : undefined;
  while (current) {
    ancestors.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return ancestors;
}

/** Renvoie vrai si `maybeDescendantId` appartient au sous-arbre de `envelopeId` (utile pour interdire de déplacer un noeud sous lui-même). */
export function isDescendantOf(
  maybeDescendantId: string,
  envelopeId: string,
  allEnvelopes: Envelope[]
): boolean {
  const byId = new Map(allEnvelopes.map((e) => [e.id, e]));
  let current = byId.get(maybeDescendantId);
  while (current?.parentId) {
    if (current.parentId === envelopeId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}
