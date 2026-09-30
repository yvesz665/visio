import { describe, it, expect } from "vitest";
import {
  checkManualTransactionOverspend,
  detectNotificationTrigger,
  hasEnoughBudgetForAutoRecurrence,
} from "@/lib/domain/transactions";

describe("checkManualTransactionOverspend (4.3)", () => {
  it("accepte le dépassement et le signale (jamais bloqué pour une saisie manuelle)", () => {
    const result = checkManualTransactionOverspend(50, 80, "expense");
    expect(result.isOverBudget).toBe(true);
    expect(result.remainingAfter).toBe(-30);
  });

  it("ne signale pas de dépassement quand le solde reste positif", () => {
    const result = checkManualTransactionOverspend(50, 20, "expense");
    expect(result.isOverBudget).toBe(false);
  });
});

describe("hasEnoughBudgetForAutoRecurrence (4.2)", () => {
  it("bloque la création automatique si le budget est insuffisant", () => {
    expect(hasEnoughBudgetForAutoRecurrence(30, 50, "expense")).toBe(false);
  });

  it("autorise toujours un revenu", () => {
    expect(hasEnoughBudgetForAutoRecurrence(0, 5000, "income")).toBe(true);
  });
});

describe("detectNotificationTrigger (section 6)", () => {
  it("détecte le franchissement du seuil d'alerte", () => {
    expect(detectNotificationTrigger(70, 85, 80)).toBe("threshold");
  });

  it("détecte le dépassement complet en priorité sur le seuil", () => {
    expect(detectNotificationTrigger(90, 105, 80)).toBe("overbudget");
  });

  it("ne notifie pas si le seuil était déjà franchi avant cette opération", () => {
    expect(detectNotificationTrigger(85, 90, 80)).toBeNull();
  });

  it("ne notifie pas si on reste sous le seuil", () => {
    expect(detectNotificationTrigger(40, 60, 80)).toBeNull();
  });
});
