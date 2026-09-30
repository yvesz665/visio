"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllEnvelopes, useEnvelopeTree, useProfile, useTransactions } from "@/hooks/useVisioData";
import { EnvelopeIcon } from "@/components/IconPicker";
import { AttachmentIndicator } from "@/components/AttachmentIndicator";
import { EnvelopeTreeView } from "@/components/EnvelopeTreeView";
import { Modal } from "@/components/Modal";
import { EnvelopeForm, type EnvelopeFormValues } from "@/components/EnvelopeForm";
import { TransferForm } from "@/components/TransferForm";
import { TransactionForm, type TransactionFormValues } from "@/components/TransactionForm";
import { findSummaryById, AllocationError } from "@/lib/domain/envelopes";
import { formatMoney } from "@/lib/domain/currency";
import {
  addAttachment,
  archiveEnvelope,
  createEnvelope,
  createTransactionWithOptionalRecurrence,
  createTransfer,
  hardDeleteEnvelope,
  updateEnvelope,
} from "@/lib/db/repository";
import { scheduleSync } from "@/lib/sync/engine";
import Link from "next/link";

export default function EnvelopeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const profile = useProfile();
  const tree = useEnvelopeTree();
  const allEnvelopes = useAllEnvelopes();
  const transactions = useTransactions(5000);

  const [showEdit, setShowEdit] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAddTx, setShowAddTx] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const currency = profile?.defaultCurrency ?? "XOF";
  const summary = tree ? findSummaryById(tree, params.id) : undefined;

  const directTransactions = useMemo(
    () => (transactions ?? []).filter((t) => t.envelopeId === params.id),
    [transactions, params.id]
  );

  const transferCandidates = useMemo(() => {
    if (!allEnvelopes) return [];
    // Un transfert peut viser n'importe quelle autre enveloppe active, y compris un
    // parent ou un enfant : c'est précisément ainsi qu'on répartit un reliquat vers le
    // bas de l'arborescence (exemple donné en 3.3). Seule l'enveloppe elle-même est exclue.
    return allEnvelopes.filter((e) => e.id !== params.id && e.status === "active");
  }, [allEnvelopes, params.id]);

  if (tree === undefined) return <p className="text-sm text-neutral-500">Chargement…</p>;
  if (!summary) return <p className="text-sm text-neutral-500">Enveloppe introuvable.</p>;

  const { envelope, children, remaining, subtreeSpent, availableForDirect, isOverBudget } = summary;
  const isRoot = envelope.parentId === null;

  async function handleEdit(values: EnvelopeFormValues) {
    if (!user) return;
    await updateEnvelope(envelope.id, user.id, values);
    void scheduleSync();
    setShowEdit(false);
  }

  async function handleAddChild(values: EnvelopeFormValues) {
    if (!user) return;
    await createEnvelope({ userId: user.id, parentId: envelope.id, ...values });
    void scheduleSync();
    setShowAddChild(false);
  }

  async function handleTransfer(p: { toEnvelopeId: string; amount: number; note: string | null }) {
    if (!user) return;
    await createTransfer({ userId: user.id, fromEnvelopeId: envelope.id, ...p });
    void scheduleSync();
    setShowTransfer(false);
  }

  async function handleAddTransaction(values: TransactionFormValues) {
    if (!user) return;
    const { attachment, ...rest } = values;
    const { transaction } = await createTransactionWithOptionalRecurrence({ userId: user.id, ...rest });
    if (attachment) {
      await addAttachment({ userId: user.id, transactionId: transaction.id, file: attachment });
    }
    void scheduleSync();
    setShowAddTx(false);
  }

  async function handleArchive() {
    if (!user) return;
    if (!confirm(`Archiver "${envelope.name}" ? Elle restera consultable dans l'historique.`)) return;
    await archiveEnvelope(envelope.id, user.id);
    void scheduleSync();
    router.push("/envelopes");
  }

  async function handleDelete() {
    if (!user) return;
    if (!confirm(`Supprimer définitivement "${envelope.name}" ?`)) return;
    try {
      await hardDeleteEnvelope(envelope.id, user.id);
      void scheduleSync();
      router.push("/envelopes");
    } catch (err) {
      setActionError(err instanceof AllocationError ? err.message : "Suppression impossible.");
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/envelopes" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900">
        <ChevronLeft className="h-4 w-4" /> Toutes les enveloppes
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${envelope.color}22`, color: envelope.color }}
          >
            <EnvelopeIcon icon={envelope.icon} className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">{envelope.name}</h1>
            <p className="text-sm text-neutral-500">
              {isRoot ? "Budget général" : envelope.isRecurring ? "Enveloppe récurrente" : "Enveloppe ponctuelle"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowEdit(true)}>
            <Pencil className="h-4 w-4" /> Modifier
          </button>
          <button className="btn-secondary" onClick={() => setShowTransfer(true)}>
            <ArrowLeftRight className="h-4 w-4" /> Transférer
          </button>
          {!isRoot && (
            <button className="btn-danger" onClick={handleArchive}>
              <Trash2 className="h-4 w-4" /> Archiver
            </button>
          )}
        </div>
      </header>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Alloué" value={formatMoney(envelope.allocatedAmount, currency)} />
        <StatCard
          label="Dépensé (cycle)"
          value={formatMoney(subtreeSpent, currency)}
          tone={isOverBudget ? "danger" : "default"}
        />
        <StatCard
          label="Restant"
          value={formatMoney(remaining, currency)}
          tone={remaining < 0 ? "danger" : "success"}
        />
      </section>

      <p className="text-xs text-neutral-500">
        Disponible pour des transactions directes sur ce nœud (hors sous-enveloppes) :{" "}
        <span className="font-medium">{formatMoney(availableForDirect, currency)}</span>
      </p>

      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">Sous-enveloppes</h2>
          <button className="btn-secondary" onClick={() => setShowAddChild(true)}>
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </div>
        {children.length === 0 ? (
          <p className="text-sm text-neutral-400">Aucune sous-enveloppe pour l&apos;instant.</p>
        ) : (
          children.map((child) => <EnvelopeTreeView key={child.envelope.id} summary={child} currency={currency} />)
        )}
      </section>

      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">Transactions directes</h2>
          <button className="btn-secondary" onClick={() => setShowAddTx(true)}>
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </div>
        {directTransactions.length === 0 ? (
          <p className="text-sm text-neutral-400">Aucune transaction directe sur cette enveloppe.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {directTransactions.slice(0, 20).map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-medium text-neutral-800">{t.description || "(sans description)"}</p>
                  <p className="text-xs text-neutral-400">{t.occurredAt}</p>
                </div>
                <div className="flex items-center gap-2">
                  <AttachmentIndicator transactionId={t.id} />
                  <span className={t.type === "expense" ? "text-red-600" : "text-brand-700"}>
                    {t.type === "expense" ? "-" : "+"}
                    {formatMoney(t.amount, currency)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isRoot && (
        <button
          onClick={handleDelete}
          className="text-xs text-neutral-400 hover:text-red-600 hover:underline"
        >
          Supprimer définitivement (uniquement si vide)
        </button>
      )}

      {showEdit && (
        <Modal title="Modifier l'enveloppe" onClose={() => setShowEdit(false)}>
          <EnvelopeForm
            initial={envelope}
            currency={currency}
            defaultThresholdPct={profile?.alertThresholdPct ?? 80}
            onSubmit={handleEdit}
            submitLabel="Enregistrer"
          />
        </Modal>
      )}

      {showAddChild && (
        <Modal title="Nouvelle sous-enveloppe" onClose={() => setShowAddChild(false)}>
          <EnvelopeForm
            currency={currency}
            defaultThresholdPct={profile?.alertThresholdPct ?? 80}
            onSubmit={handleAddChild}
          />
        </Modal>
      )}

      {showTransfer && (
        <Modal title="Transférer un montant" onClose={() => setShowTransfer(false)}>
          <TransferForm
            fromEnvelope={envelope}
            candidates={transferCandidates}
            currency={currency}
            onSubmit={handleTransfer}
          />
        </Modal>
      )}

      {showAddTx && allEnvelopes && (
        <Modal title="Nouvelle transaction" onClose={() => setShowAddTx(false)}>
          <TransactionForm envelopes={allEnvelopes} defaultEnvelopeId={envelope.id} onSubmit={handleAddTransaction} />
        </Modal>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger";
}) {
  const toneClass =
    tone === "danger" ? "text-red-600" : tone === "success" ? "text-brand-700" : "text-neutral-900";
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
