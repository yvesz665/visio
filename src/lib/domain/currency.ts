/**
 * Montants et devises.
 *
 * CONVENTION : tous les montants du domaine sont stockés en entiers, en sous-unité
 * ×100 de la devise (voir src/types/domain.ts), y compris pour une devise sans
 * centimes d'usage comme le XOF. Ce choix évite toute dérive d'arrondi lors d'un
 * changement de devise (50 000 FCFA converti en 76,22 EUR perdrait sa précision si on
 * arrondissait au FCFA près avant de convertir). `convertMinorUnits` est le SEUL point
 * d'arrondi de toute l'application pour la conversion de devise ; toute autre
 * transformation de montant doit passer par les fonctions ci-dessous.
 */

/** Convertit une saisie utilisateur (ex: "50000" ou "42.50") en entier ×100 stocké. */
export function toMinorUnits(displayValue: number): number {
  return Math.round(displayValue * 100);
}

/** Convertit un entier ×100 stocké en valeur numérique d'affichage (ex: 7622 -> 76.22). */
export function fromMinorUnits(minorUnits: number): number {
  return minorUnits / 100;
}

/**
 * Conversion de devise (9.3) : unique fonction d'arrondi de l'application. Utilisée à
 * la fois côté client (aperçu immédiat) et documentée comme devant produire exactement
 * le même résultat que la fonction Postgres `apply_currency_conversion`
 * (round(amount * rate), les deux arrondissant "au plus proche" sur des montants
 * toujours positifs, donc équivalentes).
 */
export function convertMinorUnits(amountMinorUnits: number, rate: number): number {
  return Math.round(amountMinorUnits * rate);
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

const ZERO_DECIMAL_CURRENCIES = new Set(["XOF"]);

/**
 * Formate un montant stocké (entier ×100) pour l'affichage. Le XOF s'affiche sans
 * décimales (Intl arrondit lui-même au plus proche), les autres devises avec 2
 * décimales — la précision ×100 reste intacte en base, seul l'affichage est arrondi.
 */
export function formatMoney(amountMinorUnits: number, currency: string, locale = "fr-FR"): string {
  const value = fromMinorUnits(amountMinorUnits);
  const fractionDigits = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: currency === "XOF" ? "code" : "symbol",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return `${value.toFixed(fractionDigits)} ${currency}`;
  }
}
