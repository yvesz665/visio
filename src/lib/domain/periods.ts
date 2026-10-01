/**
 * Formules de calcul des périodes budgétaires : report d'une période à l'autre, et
 * solde réel (rentrées vs dépenses/remboursements).
 *
 * Module PUR (aucune dépendance Dexie/Supabase), utilisé à l'identique :
 *  - côté client, pour l'affichage immédiat (y compris hors-ligne, marqué "provisoire"
 *    tant que non confirmé par le serveur, voir isProvisional sur EnvelopeSummary) ;
 *  - comme référence côté serveur : les fonctions Postgres `close_envelope_period` et
 *    `recalculate_periods_from` (supabase/migrations/0003_*.sql) appliquent exactement
 *    ces mêmes formules et restent l'autorité pour la persistance des périodes closes
 *    et les recalculs en cascade (transactions DB requises, donc implémentées en
 *    plpgsql plutôt qu'appelées depuis ce module).
 *
 * Tous les montants sont des entiers en sous-unité ×100 (voir src/types/domain.ts).
 */

export interface PeriodAmounts {
  allocatedAmount: number;
  carryIn: number;
  transfersIn: number;
  transfersOut: number;
  spent: number;
}

/**
 * disponible = alloué + report reçu + transferts entrants - transferts sortants - dépensé.
 * Peut être négatif (déficit reporté supérieur à l'alloué) : c'est un état valide, à
 * afficher clairement et qui doit déclencher les alertes de seuil.
 */
export function computeDisponible(p: PeriodAmounts): number {
  return p.allocatedAmount + p.carryIn - p.spent + p.transfersIn - p.transfersOut;
}

/** Le report vers la période suivante est exactement le disponible en fin de période. */
export function computeCarryOut(p: PeriodAmounts): number {
  return computeDisponible(p);
}

export interface SoldeReelAmounts {
  /** Total des rentrées (IncomeEntry), indépendantes des enveloppes. */
  incomeEntriesTotal: number;
  /** Total de toutes les dépenses confirmées (transactions type "expense"), budget + hors budget. */
  expenseTotal: number;
  /** Total des remboursements (transactions type "income" rattachées ou non à une enveloppe). */
  reimbursementTotal: number;
}

/**
 * solde réel = rentrées - (dépenses confirmées - remboursements)
 *            = rentrées - dépenses + remboursements.
 * Un remboursement n'est pas une rentrée, mais il doit réduire l'impact des dépenses
 * sur le solde réel (ex: un ami qui rembourse une dépense ne doit pas faire paraître le
 * solde plus bas qu'il ne l'est réellement).
 */
export function computeSoldeReel(p: SoldeReelAmounts): number {
  return p.incomeEntriesTotal - p.expenseTotal + p.reimbursementTotal;
}

/** Pourcentage consommé pour l'affichage/les alertes de seuil, jamais de division par zéro. */
export function computePercentConsumed(spent: number, allocatedAmount: number): number {
  return allocatedAmount > 0 ? (spent / allocatedAmount) * 100 : 0;
}

export interface ClosedPeriod {
  cycleStart: string; // ISO date
  cycleEnd: string; // ISO date, exclusif
  allocatedAmount: number;
  carryIn: number;
  transfersIn: number;
  transfersOut: number;
  spent: number;
  carryOut: number;
}

/**
 * Calcule la séquence complète des périodes CLOSES d'une enveloppe récurrente, du
 * premier cycle contenant sa date de création jusqu'au dernier cycle entièrement
 * terminé avant `now` (celui en cours n'est jamais clos). Chaque report est propagé au
 * suivant (carryIn = carryOut du précédent).
 *
 * Référence canonique de l'algorithme de clôture, y compris en RATTRAPAGE (plusieurs
 * cycles jamais clos d'affilée, ex: après une longue coupure). Implémenté en parallèle,
 * avec la même logique, par la fonction Postgres `close_envelope_period`
 * (supabase/migrations/0003_*.sql) qui est l'autorité pour la persistance ; ce module
 * reste la référence testée unitairement pour cet algorithme.
 */
export function computeClosedPeriods(params: {
  envelopeCreatedAt: Date;
  allocatedAmount: number;
  anchorDay: number;
  now: Date;
  /** Calcule le cycle [start, end) d'une date de référence pour cet anchorDay. */
  cycleWindow: (reference: Date, anchorDay: number) => { start: Date; end: Date };
  spentInWindow: (start: Date, end: Date) => number;
  transfersInWindow: (start: Date, end: Date) => { transfersIn: number; transfersOut: number };
  maxIterations?: number;
}): ClosedPeriod[] {
  const periods: ClosedPeriod[] = [];
  let cursorRef = params.envelopeCreatedAt;
  let carryIn = 0;
  const maxIterations = params.maxIterations ?? 1200;

  for (let i = 0; i < maxIterations; i++) {
    const { start, end } = params.cycleWindow(cursorRef, params.anchorDay);
    if (end.getTime() > params.now.getTime()) break; // période en cours : jamais close

    const spent = params.spentInWindow(start, end);
    const { transfersIn, transfersOut } = params.transfersInWindow(start, end);
    const carryOut = computeCarryOut({
      allocatedAmount: params.allocatedAmount,
      carryIn,
      transfersIn,
      transfersOut,
      spent,
    });

    periods.push({
      cycleStart: start.toISOString().slice(0, 10),
      cycleEnd: end.toISOString().slice(0, 10),
      allocatedAmount: params.allocatedAmount,
      carryIn,
      transfersIn,
      transfersOut,
      spent,
      carryOut,
    });

    carryIn = carryOut;
    cursorRef = end;
  }

  return periods;
}
