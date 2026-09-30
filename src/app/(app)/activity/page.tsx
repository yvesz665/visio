"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useJournalEvents } from "@/hooks/useVisioData";
import { describeJournalEvent } from "@/lib/domain/describe-event";
import { undoLastAction } from "@/lib/db/repository";
import { UndoError } from "@/lib/domain/journal";
import { scheduleSync } from "@/lib/sync/engine";

/** Journal d'activité et annulation (section 5). */
export default function ActivityPage() {
  const { user } = useAuth();
  const events = useJournalEvents(200);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  const mostRecent = events?.find((e) => !e.isUndone);

  async function handleUndo() {
    if (!user) return;
    setUndoing(true);
    setError(null);
    try {
      await undoLastAction(user.id);
      void scheduleSync();
    } catch (err) {
      setError(err instanceof UndoError ? err.message : "Impossible d'annuler cette action.");
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Activité récente</h1>
          <p className="text-sm text-neutral-500">
            Historique complet de vos actions. Vous pouvez annuler la dernière, puis celle d&apos;avant.
          </p>
        </div>
        <button className="btn-secondary" onClick={handleUndo} disabled={undoing || !mostRecent}>
          <Undo2 className="h-4 w-4" /> {undoing ? "Annulation…" : "Annuler la dernière action"}
        </button>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="card">
        {!events || events.length === 0 ? (
          <p className="text-sm text-neutral-400">Aucune activité pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {events.map((e) => (
              <li
                key={e.id}
                className={`flex items-center justify-between py-2.5 text-sm ${
                  e.isUndone ? "text-neutral-400 line-through" : "text-neutral-800"
                }`}
              >
                <span>{describeJournalEvent(e)}</span>
                <span className="text-xs text-neutral-400">
                  {new Date(e.clientCreatedAt).toLocaleString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
