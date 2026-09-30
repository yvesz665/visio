"use client";

import { useState, type FormEvent } from "react";
import type { Envelope } from "@/types/domain";
import { AllocationError } from "@/lib/domain/envelopes";

/** Transfert d'un montant alloué d'une enveloppe vers une autre (3.3). */
export function TransferForm({
  fromEnvelope,
  candidates,
  currency,
  onSubmit,
}: {
  fromEnvelope: Envelope;
  candidates: Envelope[];
  currency: string;
  onSubmit: (params: { toEnvelopeId: string; amount: number; note: string | null }) => Promise<void>;
}) {
  const [toEnvelopeId, setToEnvelopeId] = useState(candidates[0]?.id ?? "");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!toEnvelopeId) {
      setError("Choisissez une enveloppe de destination.");
      return;
    }
    if (amount <= 0) {
      setError("Le montant doit être positif.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ toEnvelopeId, amount, note: note.trim() || null });
    } catch (err) {
      setError(err instanceof AllocationError ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-neutral-600">
        Depuis <span className="font-medium">{fromEnvelope.name}</span>
      </p>
      <div>
        <label className="label" htmlFor="toEnvelope">
          Vers
        </label>
        <select
          id="toEnvelope"
          className="input"
          value={toEnvelopeId}
          onChange={(e) => setToEnvelopeId(e.target.value)}
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="transferAmount">
          Montant ({currency})
        </label>
        <input
          id="transferAmount"
          type="number"
          min={0}
          step="0.01"
          className="input"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </div>
      <div>
        <label className="label" htmlFor="transferNote">
          Note (optionnelle)
        </label>
        <input id="transferNote" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={submitting}>
        {submitting ? "Transfert…" : "Transférer"}
      </button>
    </form>
  );
}
