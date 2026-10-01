"use client";

import { useState, type FormEvent } from "react";
import { fromMinorUnits, toMinorUnits } from "@/lib/domain/currency";
import type { IncomeEntry, IncomeSource } from "@/types/domain";

export interface IncomeEntryFormValues {
  amount: number;
  occurredAt: string;
  sourceId: string;
  description: string | null;
}

/** Saisie d'une rentrée d'argent, distincte des enveloppes (section "Rentrées d'argent"). */
export function IncomeEntryForm({
  sources,
  initial,
  onSubmit,
}: {
  sources: IncomeSource[];
  initial?: Pick<IncomeEntry, "amount" | "occurredAt" | "sourceId" | "description">;
  onSubmit: (values: IncomeEntryFormValues) => Promise<void>;
}) {
  const [amount, setAmount] = useState(initial ? fromMinorUnits(initial.amount) : 0);
  const [occurredAt, setOccurredAt] = useState(
    () => initial?.occurredAt ?? new Date().toISOString().slice(0, 10)
  );
  const [sourceId, setSourceId] = useState(initial?.sourceId ?? sources[0]?.id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (amount <= 0) {
      setError("Le montant doit être positif.");
      return;
    }
    if (!sourceId) {
      setError("Choisissez une source.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        amount: toMinorUnits(amount),
        occurredAt,
        sourceId,
        description: description.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="incomeAmount">
          Montant
        </label>
        <input
          id="incomeAmount"
          type="number"
          min={0}
          step="0.01"
          className="input"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </div>
      <div>
        <label className="label" htmlFor="incomeDate">
          Date
        </label>
        <input
          id="incomeDate"
          type="date"
          className="input"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="incomeSource">
          Source
        </label>
        <select id="incomeSource" className="input" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="incomeDescription">
          Description (optionnelle)
        </label>
        <input
          id="incomeDescription"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={submitting}>
        {submitting ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}
