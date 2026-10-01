import { describe, it, expect } from "vitest";
import {
  addInterval,
  currentCycleStart,
  currentCycleEnd,
  isWithinCycle,
  formatCycleRange,
  todayInTimeZone,
} from "@/lib/domain/recurrence";

describe("addInterval", () => {
  it("ajoute un intervalle libre en jours (ex: tous les 45 jours, 4.2)", () => {
    const d = addInterval(new Date("2026-01-01T00:00:00Z"), 45, "day");
    expect(d.toISOString().slice(0, 10)).toBe("2026-02-15");
  });

  it("ajoute des mois en écrêtant sur les mois plus courts", () => {
    const d = addInterval(new Date("2026-01-31T00:00:00Z"), 1, "month");
    // février 2026 n'a que 28 jours
    expect(d.toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

describe("currentCycleStart / currentCycleEnd (cycle ancré, ex: du 25 au 25)", () => {
  it("retombe sur le mois précédent si on est avant le jour d'ancrage", () => {
    const start = currentCycleStart(new Date("2026-03-10T00:00:00Z"), 25);
    expect(start.toISOString().slice(0, 10)).toBe("2026-02-25");
  });

  it("reste sur le mois courant si on est après le jour d'ancrage", () => {
    const start = currentCycleStart(new Date("2026-03-27T00:00:00Z"), 25);
    expect(start.toISOString().slice(0, 10)).toBe("2026-03-25");
  });

  it("le cycle suivant commence exactement là où le précédent finit", () => {
    const today = new Date("2026-03-27T00:00:00Z");
    const end = currentCycleEnd(today, 25);
    expect(end.toISOString().slice(0, 10)).toBe("2026-04-25");
  });

  it("isWithinCycle borne correctement (fin exclusive)", () => {
    const start = new Date("2026-02-25T00:00:00Z");
    const end = new Date("2026-03-25T00:00:00Z");
    expect(isWithinCycle(new Date("2026-02-25T00:00:00Z"), start, end)).toBe(true);
    expect(isWithinCycle(new Date("2026-03-24T00:00:00Z"), start, end)).toBe(true);
    expect(isWithinCycle(new Date("2026-03-25T00:00:00Z"), start, end)).toBe(false);
  });
});

describe("formatCycleRange — affichage clair du cycle (visibilité demandée)", () => {
  it("affiche le dernier jour réellement inclus, pas la borne exclusive", () => {
    // Cycle [1 oct, 1 nov) : le dernier jour inclus est le 31 octobre, pas le 1er novembre.
    const label = formatCycleRange("2026-10-01", "2026-11-01");
    expect(label).toContain("1 oct");
    expect(label).toContain("31 oct");
    expect(label).not.toContain("1 nov");
  });
});

describe("todayInTimeZone", () => {
  it("résout le jour calendaire selon le fuseau, pas selon UTC", () => {
    // 23h locales à Ouagadougou (UTC+0) un 31 janvier correspond encore à UTC, donc
    // le test porte sur un fuseau décalé : 23h UTC le 31 janvier = déjà le 1er février
    // à Paris (UTC+1 en hiver... non, +1 ferait 0h, testons un fuseau où le décalage
    // fait clairement changer de jour calendaire).
    const instant = new Date("2026-01-31T23:30:00Z");
    const tokyo = todayInTimeZone(instant, "Asia/Tokyo"); // UTC+9 : déjà le 1er février
    expect(tokyo.toISOString().slice(0, 10)).toBe("2026-02-01");
    const utc = todayInTimeZone(instant, "UTC");
    expect(utc.toISOString().slice(0, 10)).toBe("2026-01-31");
  });
});
