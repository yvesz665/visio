"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useAllEnvelopes,
  usePendingRecurrences,
  useProfile,
  useRecurrenceRules,
  useTransactions,
} from "@/hooks/useVisioData";
import { Modal } from "@/components/Modal";
import { TransactionForm, type TransactionFormValues } from "@/components/TransactionForm";
import { AttachmentIndicator } from "@/components/AttachmentIndicator";
import { formatMoney } from "@/lib/domain/currency";
import {
  addAttachment,
  confirmPendingRecurrence,
  createTransactionWithOptionalRecurrence,
  deleteTransaction,
  dismissPendingRecurrence,
  updateTransaction,
} from "@/lib/db/repository";
import { scheduleSync } from "@/lib/sync/engine";
import type { Transaction } from "@/types/domain";

export default function TransactionsPage() {
  const { user } = useAuth();
  const profile = useProfile();
  const envelopes = useAllEnvelopes();
  const transactions = useTransactions(2000);
  const pending = usePendingRecurrences();
  const rules = useRecurrenceRules();

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const currency = profile?.defaultCurrency ?? "XOF";
  const envelopeName = useMemo(() => {
    const map = new Map((envelopes ?? []).map((e) => [e.id, e.name]));
    return (id: string) => map.get(id) ?? "?";
  }, [envelopes]);

  async function handleAdd(values: TransactionFormValues) {
    if (!user) return;
    const { attachment, ...rest } = values;
    const { transaction } = await createTransactionWithOptionalRecurrence({ userId: user.id, ...rest });
    if (attachment) {
      await addAttachment({ userId: user.id, transactionId: transaction.id, file: attachment });
    }
    void scheduleSync();
    setShowAdd(false);
  }

  async function handleEditSubmit(values: TransactionFormValues) {
    if (!user || !editing) return;
    await updateTransaction(editing.id, user.id, {
      amount: values.amount,
      type: values.type,
      occurredAt: values.occurredAt,
      description: values.description,
      envelopeId: values.envelopeId,
    });
    if (values.attachment) {
      await addAttachment({ userId: user.id, transactionId: editing.id, file: values.attachment });
    }
    void scheduleSync();
    setEditing(null);
  }

  async function handleDelete(tx: Transaction) {
    if (!user) return;
    if (!confirm("Supprimer cette transaction ?")) return;
    await deleteTransaction(tx.id, user.id);
    void scheduleSync();
  }

  async function handleConfirmPending(pendingId: string) {
    if (!user) return;
    const p = pending?.find((x) => x.id === pendingId);
    if (!p) return;
    await confirmPendingRecurrence(p, user.id);
    void scheduleSync();
  }

  async function handleDismissPending(pendingId: string) {
    if (!user) return;
    const p = pending?.find((x) => x.id === pendingId);
    if (!p) return;
    await dismissPendingRecurrence(p, user.id);
    void scheduleSync();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Transactions</h1>
          <p className="text-sm text-neutral-500">Revenus et dépenses, ponctuels ou récurrents.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </header>

      {pending && pending.length > 0 && (
        <section className="card border-amber-200 bg-amber-50">
          <h2 className="mb-3 text-sm font-semibold text-amber-900">
            Échéances récurrentes en attente de confirmation (4.2)
          </h2>
          <p className="mb-3 text-xs text-amber-800">
            Le budget disponible était insuffisant au moment prévu : confirmez ou ignorez chaque échéance.
          </p>
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg bg-white p-3 text-sm shadow-sm">
                <div>
                  <p className="font-medium">{p.description || envelopeName(p.envelopeId)}</p>
                  <p className="text-xs text-neutral-500">
                    {p.scheduledDate} — {formatMoney(p.amount, currency)} sur {envelopeName(p.envelopeId)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="btn-secondary" onClick={() => handleDismissPending(p.id)}>
                    Ignorer
                  </button>
                  <button className="btn-primary" onClick={() => handleConfirmPending(p.id)}>
                    Confirmer
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rules && rules.filter((r) => r.status === "active").length > 0 && (
        <section className="card">
          <h2 className="mb-2 text-sm font-semibold text-neutral-700">Récurrences actives</h2>
          <ul className="divide-y divide-neutral-100 text-sm">
            {rules
              .filter((r) => r.status === "active")
              .map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span>
                    {r.description || envelopeName(r.envelopeId)} — tous les {r.intervalValue}{" "}
                    {r.intervalUnit === "day" ? "jour(s)" : r.intervalUnit === "week" ? "semaine(s)" : r.intervalUnit === "month" ? "mois" : "an(s)"}
                  </span>
                  <span className={r.type === "expense" ? "text-red-600" : "text-brand-700"}>
                    {formatMoney(r.amount, currency)}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Historique</h2>
        {!transactions || transactions.length === 0 ? (
          <p className="text-sm text-neutral-400">Aucune transaction pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-800">{t.description || "(sans description)"}</p>
                  <p className="text-xs text-neutral-400">
                    {t.occurredAt} · {envelopeName(t.envelopeId)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <AttachmentIndicator transactionId={t.id} />
                  <span className={t.type === "expense" ? "font-medium text-red-600" : "font-medium text-brand-700"}>
                    {t.type === "expense" ? "-" : "+"}
                    {formatMoney(t.amount, currency)}
                  </span>
                  <button onClick={() => setEditing(t)} className="text-neutral-400 hover:text-neutral-700" aria-label="Modifier">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(t)} className="text-neutral-400 hover:text-red-600" aria-label="Supprimer">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showAdd && envelopes && (
        <Modal title="Nouvelle transaction" onClose={() => setShowAdd(false)}>
          <TransactionForm envelopes={envelopes} onSubmit={handleAdd} />
        </Modal>
      )}

      {editing && envelopes && (
        <Modal title="Modifier la transaction" onClose={() => setEditing(null)}>
          <TransactionForm
            envelopes={envelopes}
            defaultEnvelopeId={editing.envelopeId}
            onSubmit={handleEditSubmit}
            allowRecurring={false}
          />
        </Modal>
      )}
    </div>
  );
}
