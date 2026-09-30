/**
 * Logique métier pure autour de l'arborescence de budgets (section 3 du cahier des charges).
 * Ce module ne dépend d'aucune infrastructure (pas de Dexie, pas de Supabase) afin de pouvoir
 * être exécuté aussi bien côté client (feedback instantané hors-ligne) que côté serveur
 * (revalidation à la synchronisation) et testé unitairement.
 */

import type { Envelope, EnvelopeSummary, Transaction } from "@/types/domain";

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
  if (total > parent.allocatedAmount + EPSILON) {
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
  if (childrenSum > newAmount + EPSILON) {
    throw new AllocationError(
      "allocation_exceeds_new_amount",
      `Le nouveau montant (${newAmount}) est inférieur à ce qui est déjà réparti aux enfants (${childrenSum}).`
    );
  }
}

const EPSILON = 0.005; // tolérance pour les arrondis monétaires (centimes)

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

/**
 * Construit l'arborescence de résumés (montant consommé / restant / alertes) à partir
 * d'une liste plate d'enveloppes et de transactions déjà filtrées sur le cycle en cours.
 */
export function buildEnvelopeTree(
  envelopes: Envelope[],
  transactionsByEnvelope: Map<string, Transaction[]>,
  defaultThresholdPct: number
): EnvelopeSummary | null {
  const byParent = new Map<string | null, Envelope[]>();
  for (const env of envelopes) {
    const key = env.parentId;
    const list = byParent.get(key) ?? [];
    list.push(env);
    byParent.set(key, list);
  }

  const root = envelopes.find((e) => e.parentId === null);
  if (!root) return null;

  function computeDirectSpent(envelopeId: string): number {
    const txs = transactionsByEnvelope.get(envelopeId) ?? [];
    return txs.reduce((sum, t) => {
      if (t.deletedAt) return sum;
      return sum + (t.type === "expense" ? t.amount : -t.amount);
    }, 0);
  }

  function build(envelope: Envelope): EnvelopeSummary {
    const childEnvelopes = (byParent.get(envelope.id) ?? [])
      .filter((e) => e.status === "active")
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const children = childEnvelopes.map(build);
    const directSpent = computeDirectSpent(envelope.id);
    const subtreeSpent = directSpent + children.reduce((s, c) => s + c.subtreeSpent, 0);
    const allocatedToChildren = childEnvelopes.reduce((s, e) => s + e.allocatedAmount, 0);
    const threshold = envelope.alertThresholdPct ?? defaultThresholdPct;
    const percentConsumed =
      envelope.allocatedAmount > 0 ? (subtreeSpent / envelope.allocatedAmount) * 100 : 0;

    return {
      envelope,
      children,
      directSpent,
      subtreeSpent,
      allocatedToChildren,
      availableForDirect: envelope.allocatedAmount - allocatedToChildren,
      remaining: envelope.allocatedAmount - subtreeSpent,
      percentConsumed,
      isOverBudget: subtreeSpent > envelope.allocatedAmount + EPSILON,
      isNearThreshold: percentConsumed >= threshold && percentConsumed < 100,
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
