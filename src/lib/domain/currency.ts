/**
 * Changement de devise (9.3) : conversion de tous les montants historiques selon un
 * taux de change. La conversion est appliquée comme une opération explicite et journalisée
 * (elle produit un événement `profile.currency_change`), jamais implicitement à l'affichage,
 * pour que l'historique reste cohérent avec ce qui a réellement été saisi.
 */

export interface ConvertibleAmounts {
  envelopeAllocations: Record<string, number>; // envelopeId -> allocatedAmount
  transactionAmounts: Record<string, number>; // transactionId -> amount
  recurrenceAmounts: Record<string, number>; // recurrenceRuleId -> amount
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function convertAllAmounts(amounts: ConvertibleAmounts, rate: number): ConvertibleAmounts {
  const convert = (map: Record<string, number>) =>
    Object.fromEntries(Object.entries(map).map(([id, amount]) => [id, roundMoney(amount * rate)]));

  return {
    envelopeAllocations: convert(amounts.envelopeAllocations),
    transactionAmounts: convert(amounts.transactionAmounts),
    recurrenceAmounts: convert(amounts.recurrenceAmounts),
  };
}

/** Liste restreinte mais couvrante de devises usuelles ; XOF reste la valeur par défaut (2.1). */
export const SUPPORTED_CURRENCIES = [
  { code: "XOF", label: "Franc CFA (BCEAO)", symbol: "FCFA" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "USD", label: "Dollar américain", symbol: "$" },
  { code: "GBP", label: "Livre sterling", symbol: "£" },
  { code: "CAD", label: "Dollar canadien", symbol: "$" },
  { code: "MAD", label: "Dirham marocain", symbol: "DH" },
  { code: "NGN", label: "Naira nigérian", symbol: "₦" },
  { code: "GHS", label: "Cedi ghanéen", symbol: "₵" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

export function formatMoney(amount: number, currency: string, locale = "fr-FR"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: currency === "XOF" ? "code" : "symbol",
      maximumFractionDigits: currency === "XOF" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
