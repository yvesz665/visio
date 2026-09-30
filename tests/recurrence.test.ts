import { describe, it, expect } from "vitest";
import { addInterval, currentCycleStart, currentCycleEnd, isWithinCycle } from "@/lib/domain/recurrence";

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
