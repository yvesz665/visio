"use client";

import { useState, type FormEvent } from "react";
import type { Envelope, IntervalUnit, TransactionType } from "@/types/domain";

export interface TransactionFormValues {
  envelopeId: string;
  amount: number;
  type: TransactionType;
  occurredAt: string;
  description: string | null;
  recurring: boolean;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  endDate: string | null;
  /** Pièce justificative optionnelle (photo de reçu/facture, 4.1). */
  attachment: File | null;
}

const INTERVAL_LABELS: Record<IntervalUnit, string> = {
  day: "jour(s)",
  week: "semaine(s)",
  month: "mois",
  year: "an(s)",
};

/** Saisie d'une transaction (4.1), simple ou récurrente à fréquence libre (4.2). */
export function TransactionForm({
  envelopes,
  defaultEnvelopeId,
  onSubmit,
  allowRecurring = true,
}: {
  envelopes: Envelope[];
  defaultEnvelopeId?: string;
  onSubmit: (values: TransactionFormValues) => Promise<void>;
  /** Masqué en édition : la récurrence se gère depuis l'écran "Transactions", pas ici. */
  allowRecurring?: boolean;
}) {
  const [envelopeId, setEnvelopeId] = useState(defaultEnvelopeId ?? envelopes[0]?.id ?? "");
  const [amount, setAmount] = useState(0);
  const [type, setType] = useState<TransactionType>("expense");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>("month");
  const [endDate, setEndDate] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!envelopeId) {
      setError("Choisissez une enveloppe.");
      return;
    }
    if (amount <= 0) {
      setError("Le montant doit être positif.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        envelopeId,
        amount,
        type,
        occurredAt,
        description: description.trim() || null,
        recurring,
        intervalValue,
        intervalUnit,
        endDate: endDate || null,
        attachment,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setType("expense")}
          className={`btn ${type === "expense" ? "bg-red-600 text-white" : "btn-secondary"}`}
        >
          Dépense
        </button>
        <button
          type="button"
          onClick={() => setType("income")}
          className={`btn ${type === "income" ? "bg-brand-600 text-white" : "btn-secondary"}`}
        >
          Revenu
        </button>
      </div>

      <div>
        <label className="label" htmlFor="txEnvelope">
          Enveloppe
        </label>
        <select id="txEnvelope" className="input" value={envelopeId} onChange={(e) => setEnvelopeId(e.target.value)}>
          {envelopes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="txAmount">
          Montant
        </label>
        <input
          id="txAmount"
          type="number"
          min={0}
          step="0.01"
          className="input"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </div>

      <div>
        <label className="label" htmlFor="txDate">
          Date
        </label>
        <input
          id="txDate"
          type="date"
          className="input"
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="txDescription">
          Description
        </label>
        <input
          id="txDescription"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="txAttachment">
          Pièce justificative (photo, optionnelle)
        </label>
        <input
          id="txAttachment"
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="block w-full text-sm text-neutral-600"
          onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
        />
        {attachment && (
          <p className="mt-1 text-xs text-neutral-500">
            {attachment.name} — sera envoyée dès que la connexion est disponible.
          </p>
        )}
      </div>

      {allowRecurring && (
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
          Transaction récurrente
        </label>
      )}

      {allowRecurring && recurring && (
        <div className="space-y-3 rounded-lg bg-neutral-50 p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-600">Tous les</span>
            <input
              type="number"
              min={1}
              className="input w-20"
              value={intervalValue}
              onChange={(e) => setIntervalValue(Number(e.target.value))}
            />
            <select
              className="input flex-1"
              value={intervalUnit}
              onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
            >
              {(Object.keys(INTERVAL_LABELS) as IntervalUnit[]).map((u) => (
                <option key={u} value={u}>
                  {INTERVAL_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="txEndDate">
              Date de fin (optionnelle)
            </label>
            <input
              id="txEndDate"
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <p className="text-xs text-neutral-500">
            Si le budget est insuffisant au moment d&apos;une échéance, elle sera mise en attente de
            votre confirmation plutôt que d&apos;être enregistrée automatiquement.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={submitting}>
        {submitting ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}
