"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useEnvelopeTree, useProfile } from "@/hooks/useVisioData";
import { EnvelopeTreeView } from "@/components/EnvelopeTreeView";
import { Modal } from "@/components/Modal";
import { EnvelopeForm, type EnvelopeFormValues } from "@/components/EnvelopeForm";
import { createEnvelope } from "@/lib/db/repository";
import { scheduleSync } from "@/lib/sync/engine";

export default function EnvelopesPage() {
  const { user } = useAuth();
  const profile = useProfile();
  const tree = useEnvelopeTree();
  const [showCreate, setShowCreate] = useState(false);

  const currency = profile?.defaultCurrency ?? "XOF";

  async function handleCreate(values: EnvelopeFormValues) {
    if (!user || !tree) return;
    await createEnvelope({
      userId: user.id,
      parentId: tree.envelope.id,
      ...values,
    });
    void scheduleSync();
    setShowCreate(false);
  }

  if (tree === undefined) return <p className="text-sm text-neutral-500">Chargement…</p>;
  if (!tree) return <p className="text-sm text-neutral-500">Aucun budget trouvé.</p>;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Enveloppes</h1>
          <p className="text-sm text-neutral-500">Votre arborescence de budget, sans limite de profondeur.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> Nouvelle enveloppe
        </button>
      </header>

      <div className="card">
        <EnvelopeTreeView summary={tree} currency={currency} />
      </div>

      {showCreate && (
        <Modal title="Nouvelle enveloppe" onClose={() => setShowCreate(false)}>
          <p className="mb-3 text-xs text-neutral-500">
            Rattachée directement à {tree.envelope.name}. Disponible pour répartition :{" "}
            {tree.availableForDirect.toLocaleString("fr-FR")} {currency}.
          </p>
          <EnvelopeForm
            currency={currency}
            defaultThresholdPct={profile?.alertThresholdPct ?? 80}
            onSubmit={handleCreate}
          />
        </Modal>
      )}
    </div>
  );
}
