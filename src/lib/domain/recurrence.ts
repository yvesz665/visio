/**
 * Calculs autour des cycles budgétaires (3.4) et des règles de récurrence (4.2).
 * Pur TypeScript, sans dépendance d'infrastructure, pour rester testable et partagé
 * entre le client (Dexie) et le serveur (job planifié qui déclenche les récurrences).
 */

import type { IntervalUnit } from "@/types/domain";

/**
 * Convertit un instant réel (ex: `new Date()`) en "aujourd'hui" tel que vu dans le
 * fuseau horaire `timeZone` (profil utilisateur, "Africa/Ouagadougou" par défaut),
 * représenté comme une date UTC-minuit portant ce même jour calendaire. Toutes les
 * fonctions de cycle ci-dessous manipulent ensuite des jours calendaires via les
 * méthodes UTC de `Date` : leur passer un instant réel non converti (ex: un `new Date()`
 * brut côté serveur, en UTC) déciderait des bornes de cycle avec le mauvais jour pour un
 * utilisateur dans un fuseau différent, notamment autour de minuit.
 */
export function todayInTimeZone(instant: Date, timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  } catch {
    // Fuseau invalide/non reconnu : repli sur UTC plutôt que de faire planter le calcul.
    return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
  }
}

/** Ajoute un intervalle libre (ex: 45 jours, 2 semaines, 1 mois, 1 an) à une date. */
export function addInterval(date: Date, value: number, unit: IntervalUnit): Date {
  const d = new Date(date.getTime());
  switch (unit) {
    case "day":
      d.setUTCDate(d.getUTCDate() + value);
      return d;
    case "week":
      d.setUTCDate(d.getUTCDate() + value * 7);
      return d;
    case "month": {
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + value);
      d.setUTCDate(clampDayToMonth(day, d.getUTCFullYear(), d.getUTCMonth()));
      return d;
    }
    case "year": {
      const day = d.getUTCDate();
      const month = d.getUTCMonth();
      d.setUTCDate(1);
      d.setUTCFullYear(d.getUTCFullYear() + value);
      d.setUTCMonth(month);
      d.setUTCDate(clampDayToMonth(day, d.getUTCFullYear(), month));
      return d;
    }
  }
}

function daysInMonth(year: number, month: number): number {
  // month est 0-indexé ; day 0 du mois suivant = dernier jour du mois courant
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function clampDayToMonth(day: number, year: number, month: number): number {
  return Math.min(day, daysInMonth(year, month));
}

/**
 * Calcule la date de début du cycle budgétaire courant contenant `today`, pour un
 * cycle mensuel ancré sur `anchorDay` (ex: du 25 du mois au 25 du mois suivant, 3.4).
 * Si le mois n'a pas ce jour (ex: 31 pour février), on retombe sur le dernier jour du mois.
 */
export function currentCycleStart(today: Date, anchorDay: number): Date {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const day = today.getUTCDate();
  const anchorThisMonth = clampDayToMonth(anchorDay, year, month);

  if (day >= anchorThisMonth) {
    return new Date(Date.UTC(year, month, anchorThisMonth));
  }
  // on est avant l'ancre ce mois-ci : le cycle courant a commencé le mois précédent
  const prevMonthDate = new Date(Date.UTC(year, month - 1, 1));
  const prevYear = prevMonthDate.getUTCFullYear();
  const prevMonth = prevMonthDate.getUTCMonth();
  return new Date(Date.UTC(prevYear, prevMonth, clampDayToMonth(anchorDay, prevYear, prevMonth)));
}

/** Fin (exclusive) du cycle courant = début du cycle suivant. */
export function currentCycleEnd(today: Date, anchorDay: number): Date {
  const start = currentCycleStart(today, anchorDay);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const nextMonthDate = new Date(Date.UTC(year, month + 1, 1));
  const nextYear = nextMonthDate.getUTCFullYear();
  const nextMonth = nextMonthDate.getUTCMonth();
  return new Date(Date.UTC(nextYear, nextMonth, clampDayToMonth(anchorDay, nextYear, nextMonth)));
}

export function isWithinCycle(date: Date, cycleStart: Date, cycleEnd: Date): boolean {
  return date.getTime() >= cycleStart.getTime() && date.getTime() < cycleEnd.getTime();
}

/**
 * Détermine si une règle de récurrence doit se déclencher à la date `today`, et calcule
 * la prochaine date d'exécution après déclenchement (support d'intervalles libres, 4.2).
 */
export function computeNextRunDate(
  currentNextRun: Date,
  intervalValue: number,
  intervalUnit: IntervalUnit
): Date {
  return addInterval(currentNextRun, intervalValue, intervalUnit);
}

export function isDue(nextRunDate: Date, today: Date): boolean {
  return nextRunDate.getTime() <= today.getTime();
}
