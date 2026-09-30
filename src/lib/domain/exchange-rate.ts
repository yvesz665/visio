/**
 * Récupération d'un taux de change pour le changement de devise (9.3). Best-effort :
 * si l'appareil est hors-ligne ou que le service est indisponible, l'appelant doit
 * proposer une saisie manuelle du taux plutôt que bloquer l'opération.
 */
export async function fetchExchangeRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data?.rates?.[to];
    return typeof rate === "number" ? rate : null;
  } catch {
    return null;
  }
}
