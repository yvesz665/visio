"use client";

/** Rentrées d'argent : entité séparée des enveloppes, avec ses propres sources (2). */

import { useMemo, useState } from "react";
import { Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIncomeEntries, useIncomeSources, useProfile } from "@/hooks/useVisioData";
import { Modal } from "@/components/Modal";
import { IncomeEntryForm, type IncomeEntryFormValues } from "@/components/IncomeEntryForm";
import { formatMoney } from "@/lib/domain/currency";
import {
  createIncomeEntry,
  createIncomeSource,
  deleteIncomeEntry,
  deleteIncomeSource,
  updateIncomeEntry,
  updateIncomeSource,
} from "@/lib/db/repository";
import { scheduleSync } from "@/lib/sync/engine";
import type { IncomeEntry } from "@/types/domain";

export default function IncomesPage() {
  const { user } = useAuth();
  const profile = useProfile();
  const sources = useIncomeSources();
  const entries = useIncomeEntries();

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<IncomeEntry | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");

  const currency = profile?.defaultCurrency ?? "XOF";
  const sourceName = useMemo(() => {
    const map = new Map((sources ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? "?";
  }, [sources]);

  const total = (entries ?? []).reduce((s, e) => s + e.amount, 0);

  async function handleAdd(values: IncomeEntryFormValues) {
    if (!user) return;
    await createIncomeEntry({ userId: user.id, ...values });
    void scheduleSync();
    setShowAdd(false);
  }

  async function handleEditSubmit(values: IncomeEntryFormValues) {
    if (!user || !editing) return;
    await updateIncomeEntry(editing.id, user.id, values);
    void scheduleSync();
    setEditing(null);
  }

  async function handleDelete(entry: IncomeEntry) {
    if (!user) return;
    if (!confirm("Supprimer cette rentrée ?")) return;
    await deleteIncomeEntry(entry.id, user.id);
    void scheduleSync();
  }

  async function handleAddSource() {
    if (!user || !newSourceName.trim()) return;
    await createIncomeSource({ userId: user.id, name: newSourceName.trim() });
    void scheduleSync();
    setNewSourceName("");
  }

  async function handleRenameSource(id: string, name: string) {
    if (!user) return;
    await updateIncomeSource(id, user.id, name);
    void scheduleSync();
  }

  async function handleDeleteSource(id: string) {
    if (!user) return;
    try {
      await deleteIncomeSource(id, user.id);
      void scheduleSync();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Suppression impossible.");
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Rentrées d&apos;argent</h1>
          <p className="text-sm text-neutral-500">
            Indépendantes de vos enveloppes : elles n&apos;alimentent aucun budget.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowSources(true)}>
            <Settings2 className="h-4 w-4" /> Sources
          </button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        </div>
      </header>

      <section className="card">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Total des rentrées</p>
        <p className="mt-1 text-xl font-semibold text-brand-700">{formatMoney(total, currency)}</p>
      </section>

      <section className="card">
        {!entries || entries.length === 0 ? (
          <p className="text-sm text-neutral-400">Aucune rentrée pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-neutral-800">
                    {e.description || sourceName(e.sourceId)}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {e.occurredAt} · {sourceName(e.sourceId)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-medium text-brand-700">+{formatMoney(e.amount, currency)}</span>
                  <button
                    onClick={() => setEditing(e)}
                    className="text-neutral-400 hover:text-neutral-700"
                    aria-label="Modifier"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(e)}
                    className="text-neutral-400 hover:text-red-600"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showAdd && (
        <Modal title="Nouvelle rentrée" onClose={() => setShowAdd(false)}>
          <IncomeEntryForm sources={sources ?? []} onSubmit={handleAdd} />
        </Modal>
      )}

      {editing && (
        <Modal title="Modifier la rentrée" onClose={() => setEditing(null)}>
          <IncomeEntryForm sources={sources ?? []} initial={editing} onSubmit={handleEditSubmit} />
        </Modal>
      )}

      {showSources && (
        <Modal title="Sources de rentrées" onClose={() => setShowSources(false)}>
          <div className="space-y-3">
            <ul className="space-y-2">
              {(sources ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <input
                    className="input flex-1"
                    defaultValue={s.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value.trim() !== s.name) {
                        handleRenameSource(s.id, e.target.value.trim());
                      }
                    }}
                  />
                  <button
                    onClick={() => handleDeleteSource(s.id)}
                    className="text-neutral-400 hover:text-red-600"
                    aria-label="Supprimer la source"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 border-t border-neutral-100 pt-3">
              <input
                className="input flex-1"
                placeholder="Nouvelle source"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
              />
              <button className="btn-secondary" onClick={handleAddSource}>
                Ajouter
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
