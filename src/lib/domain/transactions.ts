/**
 * Règles autour des transactions (section 4) : dépassement de budget et détection des
 * franchissements de seuil qui déclenchent une notification (section 6).
 */

export interface OverspendCheck {
  isOverBudget: boolean;
  remainingAfter: number;
}

/**
 * Une transaction saisie manuellement qui dépasse le solde disponible est acceptée
 * quand même (4.3) : l'enveloppe passe simplement en solde négatif avec alerte visuelle.
 * Cette fonction ne bloque donc jamais ; elle renseigne juste l'état résultant.
 */
export function checkManualTransactionOverspend(
  remainingBefore: number,
  amount: number,
  type: "income" | "expense"
): OverspendCheck {
  const delta = type === "expense" ? -amount : amount;
  const remainingAfter = remainingBefore + delta;
  return { isOverBudget: remainingAfter < 0, remainingAfter };
}

/**
 * Une récurrence automatique qui n'a plus assez de budget disponible n'est PAS créée :
 * elle est mise en attente de confirmation manuelle (4.2). Contrairement à la saisie
 * manuelle, ici on bloque la création automatique si le solde deviendrait négatif.
 */
export function hasEnoughBudgetForAutoRecurrence(
  availableAmount: number,
  amount: number,
  type: "income" | "expense"
): boolean {
  if (type === "income") return true; // un revenu ne consomme jamais de budget
  return amount <= availableAmount;
}

export type NotificationTrigger = "threshold" | "overbudget" | null;

/**
 * Compare le pourcentage consommé avant/après une opération pour ne notifier que sur un
 * franchissement (évite de spammer à chaque transaction une fois le seuil déjà dépassé).
 */
export function detectNotificationTrigger(
  percentBefore: number,
  percentAfter: number,
  thresholdPct: number
): NotificationTrigger {
  const crossedOverbudget = percentBefore < 100 && percentAfter >= 100;
  if (crossedOverbudget) return "overbudget";

  const crossedThreshold = percentBefore < thresholdPct && percentAfter >= thresholdPct;
  if (crossedThreshold) return "threshold";

  return null;
}
