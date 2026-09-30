"use client";

/**
 * Parcours d'accueil guidé (9.2) : l'utilisateur ne doit jamais atterrir sur un tableau
 * de bord vide. Trois étapes : devise + cycle, budget général de départ, premières
 * enveloppes. La création effective se fait via /api/onboarding/complete (nécessite
 * d'être en ligne, comme l'inscription qui précède), puis est recopiée dans IndexedDB
 * pour que le reste de l'application n'ait plus jamais besoin du réseau pour lire ces
 * données.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getDb } from "@/lib/db/dexie";
import { generateId } from "@/lib/utils/id";
import { SUPPORTED_CURRENCIES } from "@/lib/domain/currency";
import { ColorPicker, IconPicker } from "@/components/IconPicker";
import type { Envelope, Profile } from "@/types/domain";

interface DraftEnvelope {
  id: string;
  name: string;
  color: string;
  icon: string;
  allocatedAmount: number;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currency, setCurrency] = useState("XOF");
  const [cycleAnchorDay, setCycleAnchorDay] = useState(1);
  const [alertThresholdPct, setAlertThresholdPct] = useState(80);

  const [rootName, setRootName] = useState("Budget général");
  const [rootAmount, setRootAmount] = useState<number>(0);

  const [envelopes, setEnvelopes] = useState<DraftEnvelope[]>([
    { id: generateId(), name: "Alimentation", color: "#158454", icon: "food", allocatedAmount: 0 },
  ]);

  const allocatedTotal = envelopes.reduce((s, e) => s + (e.allocatedAmount || 0), 0);
  const remaining = rootAmount - allocatedTotal;

  function addEnvelope() {
    setEnvelopes((prev) => [
      ...prev,
      { id: generateId(), name: "", color: "#2563eb", icon: "wallet", allocatedAmount: 0 },
    ]);
  }

  function updateEnvelope(id: string, changes: Partial<DraftEnvelope>) {
    setEnvelopes((prev) => prev.map((e) => (e.id === id ? { ...e, ...changes } : e)));
  }

  function removeEnvelope(id: string) {
    setEnvelopes((prev) => prev.filter((e) => e.id !== id));
  }

  async function finish() {
    if (!user) return;
    if (remaining < 0) {
      setError("La somme des enveloppes dépasse le budget général. Ajustez les montants.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const rootId = generateId();
    const payload = {
      currency,
      cycleAnchorDay,
      alertThresholdPct,
      rootEnvelope: { id: rootId, name: rootName, color: "#158454", icon: "wallet", allocatedAmount: rootAmount },
      initialEnvelopes: envelopes
        .filter((e) => e.name.trim().length > 0)
        .map((e) => ({ ...e })),
    };

    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Une erreur est survenue.");
      }
      const data: { profile: Profile; envelopes: Envelope[] } = await res.json();

      const db = getDb();
      await db.transaction("rw", [db.profiles, db.envelopes], async () => {
        await db.profiles.put({ ...data.profile, syncStatus: "synced" } as Profile);
        for (const env of data.envelopes) {
          await db.envelopes.put({ ...env, syncStatus: "synced" });
        }
      });

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-10">
      <div className="mb-6 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-brand-600" : "bg-neutral-200"}`} />
        ))}
      </div>

      {step === 0 && (
        <div className="card space-y-4">
          <h1 className="text-xl font-semibold">Bienvenue sur Visio</h1>
          <p className="text-sm text-neutral-600">
            Commençons par votre devise et la date à laquelle votre budget se réinitialise chaque mois.
          </p>
          <div>
            <label className="label" htmlFor="currency">
              Devise
            </label>
            <select
              id="currency"
              className="input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {SUPPORTED_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cycleDay">
              Jour de renouvellement du cycle (ex : 25 pour &laquo; du 25 au 25 &raquo;)
            </label>
            <input
              id="cycleDay"
              type="number"
              min={1}
              max={31}
              className="input"
              value={cycleAnchorDay}
              onChange={(e) => setCycleAnchorDay(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label" htmlFor="threshold">
              Seuil d&apos;alerte par défaut (%)
            </label>
            <input
              id="threshold"
              type="number"
              min={1}
              max={100}
              className="input"
              value={alertThresholdPct}
              onChange={(e) => setAlertThresholdPct(Number(e.target.value))}
            />
          </div>
          <button className="btn-primary w-full" onClick={() => setStep(1)}>
            Continuer
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="card space-y-4">
          <h1 className="text-xl font-semibold">Votre budget général</h1>
          <p className="text-sm text-neutral-600">
            C&apos;est le montant total dont vous disposez pour ce cycle. Vous pourrez le modifier à tout moment.
          </p>
          <div>
            <label className="label" htmlFor="rootName">
              Nom
            </label>
            <input id="rootName" className="input" value={rootName} onChange={(e) => setRootName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rootAmount">
              Montant ({currency})
            </label>
            <input
              id="rootAmount"
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={rootAmount}
              onChange={(e) => setRootAmount(Number(e.target.value))}
            />
          </div>
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setStep(0)}>
              Retour
            </button>
            <button className="btn-primary flex-1" onClick={() => setStep(2)} disabled={rootAmount <= 0}>
              Continuer
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-4">
          <h1 className="text-xl font-semibold">Premières enveloppes</h1>
          <p className="text-sm text-neutral-600">
            Répartissez une partie de votre budget général. Restant à répartir :{" "}
            <span className={remaining < 0 ? "font-semibold text-red-600" : "font-semibold text-brand-700"}>
              {remaining.toLocaleString("fr-FR")} {currency}
            </span>
          </p>

          <div className="space-y-4">
            {envelopes.map((env) => (
              <div key={env.id} className="rounded-lg border border-neutral-200 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Nom de l'enveloppe"
                    value={env.name}
                    onChange={(e) => updateEnvelope(env.id, { name: e.target.value })}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input w-32"
                    placeholder="Montant"
                    value={env.allocatedAmount || ""}
                    onChange={(e) => updateEnvelope(env.id, { allocatedAmount: Number(e.target.value) })}
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvelope(env.id)}
                    className="text-sm text-neutral-400 hover:text-red-600"
                    aria-label="Supprimer"
                  >
                    ✕
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <IconPicker value={env.icon} onChange={(icon) => updateEnvelope(env.id, { icon })} />
                  <ColorPicker value={env.color} onChange={(color) => updateEnvelope(env.id, { color })} />
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addEnvelope} className="btn-secondary w-full">
            + Ajouter une enveloppe
          </button>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setStep(1)}>
              Retour
            </button>
            <button className="btn-primary flex-1" onClick={finish} disabled={submitting || remaining < 0}>
              {submitting ? "Création…" : "Terminer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
