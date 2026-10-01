"use client";

import { useState, type FormEvent } from "react";
import { ColorPicker, IconPicker } from "./IconPicker";
import { AllocationError } from "@/lib/domain/envelopes";
import { fromMinorUnits, toMinorUnits } from "@/lib/domain/currency";
import type { Envelope } from "@/types/domain";

export interface EnvelopeFormValues {
  name: string;
  color: string;
  icon: string;
  allocatedAmount: number;
  isRecurring: boolean;
  cycleMode: "inherit" | "custom";
  cycleAnchorDay: number | null;
  alertThresholdPct: number | null;
}

export function EnvelopeForm({
  initial,
  currency,
  defaultThresholdPct,
  onSubmit,
  submitLabel = "Créer",
}: {
  initial?: Partial<Envelope>;
  currency: string;
  defaultThresholdPct: number;
  onSubmit: (values: EnvelopeFormValues) => Promise<void>;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#158454");
  const [icon, setIcon] = useState(initial?.icon ?? "wallet");
  const [allocatedAmount, setAllocatedAmount] = useState(
    initial?.allocatedAmount != null ? fromMinorUnits(initial.allocatedAmount) : 0
  );
  const [isRecurring, setIsRecurring] = useState(initial?.isRecurring ?? true);
  const [customCycle, setCustomCycle] = useState((initial?.cycleMode ?? "inherit") === "custom");
  const [cycleAnchorDay, setCycleAnchorDay] = useState(initial?.cycleAnchorDay ?? 1);
  const [customThreshold, setCustomThreshold] = useState(initial?.alertThresholdPct != null);
  const [alertThresholdPct, setAlertThresholdPct] = useState(
    initial?.alertThresholdPct ?? defaultThresholdPct
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Le nom est obligatoire.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        color,
        icon,
        allocatedAmount: toMinorUnits(allocatedAmount),
        isRecurring,
        cycleMode: customCycle ? "custom" : "inherit",
        cycleAnchorDay: customCycle ? cycleAnchorDay : null,
        alertThresholdPct: customThreshold ? alertThresholdPct : null,
      });
    } catch (err) {
      if (err instanceof AllocationError) setError(err.message);
      else setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="envName">
          Nom
        </label>
        <input id="envName" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="label" htmlFor="envAmount">
          Montant alloué ({currency})
        </label>
        <input
          id="envAmount"
          type="number"
          min={0}
          step="0.01"
          className="input"
          value={allocatedAmount}
          onChange={(e) => setAllocatedAmount(Number(e.target.value))}
        />
      </div>

      <div>
        <p className="label">Icône</p>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      <div>
        <p className="label">Couleur</p>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
        Enveloppe récurrente (le montant se réinitialise à chaque cycle)
      </label>

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={customCycle} onChange={(e) => setCustomCycle(e.target.checked)} />
        Cycle personnalisé pour cette enveloppe
      </label>
      {customCycle && (
        <div>
          <label className="label" htmlFor="envCycleDay">
            Jour de renouvellement
          </label>
          <input
            id="envCycleDay"
            type="number"
            min={1}
            max={31}
            className="input"
            value={cycleAnchorDay}
            onChange={(e) => setCycleAnchorDay(Number(e.target.value))}
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={customThreshold}
          onChange={(e) => setCustomThreshold(e.target.checked)}
        />
        Seuil d&apos;alerte spécifique
      </label>
      {customThreshold && (
        <div>
          <label className="label" htmlFor="envThreshold">
            Seuil (%)
          </label>
          <input
            id="envThreshold"
            type="number"
            min={1}
            max={100}
            className="input"
            value={alertThresholdPct}
            onChange={(e) => setAlertThresholdPct(Number(e.target.value))}
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={submitting}>
        {submitting ? "Enregistrement…" : submitLabel}
      </button>
    </form>
  );
}
