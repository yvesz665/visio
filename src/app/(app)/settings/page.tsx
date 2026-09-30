"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Download, LogOut, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useVisioData";
import { SUPPORTED_CURRENCIES } from "@/lib/domain/currency";
import { fetchExchangeRate } from "@/lib/domain/exchange-rate";
import { changeCurrency, updateProfile } from "@/lib/db/repository";
import { scheduleSync } from "@/lib/sync/engine";
import { getPushPermissionState, subscribeToPush } from "@/lib/notifications/push-client";
import { exportAllDataAsJson } from "@/lib/export/data-export";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearLocalDatabase } from "@/lib/db/dexie";

export default function SettingsPage() {
  const { user, session, signOut } = useAuth();
  const router = useRouter();
  const profile = useProfile();

  const [newCurrency, setNewCurrency] = useState("XOF");
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [manualRate, setManualRate] = useState<number>(1);
  const [currencyBusy, setCurrencyBusy] = useState(false);
  const [currencyMessage, setCurrencyMessage] = useState<string | null>(null);

  const [threshold, setThreshold] = useState(80);
  const [pushState, setPushState] = useState<string>("checking");

  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (profile) {
      setNewCurrency(profile.defaultCurrency);
      setThreshold(profile.alertThresholdPct);
    }
  }, [profile]);

  useEffect(() => {
    getPushPermissionState().then(setPushState);
  }, []);

  async function handleFetchRate() {
    if (!profile) return;
    setRateLoading(true);
    const r = await fetchExchangeRate(profile.defaultCurrency, newCurrency);
    setRate(r);
    if (r) setManualRate(r);
    setRateLoading(false);
  }

  async function handleApplyCurrency() {
    if (!user || !profile) return;
    setCurrencyBusy(true);
    setCurrencyMessage(null);
    try {
      await changeCurrency({ userId: user.id, profile, newCurrency, rate: manualRate });
      void scheduleSync();
      setCurrencyMessage("Devise mise à jour. Tous les montants ont été reconvertis.");
    } catch {
      setCurrencyMessage("Une erreur est survenue.");
    } finally {
      setCurrencyBusy(false);
    }
  }

  async function handleThresholdSave() {
    if (!user) return;
    await updateProfile(user.id, { alertThresholdPct: threshold });
    void scheduleSync();
  }

  async function handleEnablePush() {
    if (!session) return;
    const ok = await subscribeToPush({ Authorization: `Bearer ${session.access_token}` });
    setPushState(ok ? "granted" : "denied");
  }

  async function handleExportData() {
    if (!user) return;
    await exportAllDataAsJson(user.id);
  }

  async function handleDeleteAccount() {
    if (!user || !session) return;
    setDeleting(true);
    try {
      await exportAllDataAsJson(user.id);
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error("delete failed");
      await clearLocalDatabase();
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push("/signup");
    } catch {
      setDeleting(false);
      alert("La suppression a échoué. Réessayez ou contactez le support.");
    }
  }

  if (!profile) return <p className="text-sm text-neutral-500">Chargement…</p>;

  return (
    <div className="max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Réglages</h1>
      </header>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold text-neutral-700">Devise (9.3)</h2>
        <p className="text-xs text-neutral-500">
          Devise actuelle : <span className="font-medium">{profile.defaultCurrency}</span>. Changer de devise
          reconvertit automatiquement tous les montants historiques.
        </p>
        <div className="flex gap-2">
          <select
            className="input"
            value={newCurrency}
            onChange={(e) => {
              setNewCurrency(e.target.value);
              setRate(null);
            }}
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label} ({c.code})
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={handleFetchRate} disabled={rateLoading}>
            {rateLoading ? "…" : "Chercher le taux"}
          </button>
        </div>
        {rate === null && newCurrency !== profile.defaultCurrency && (
          <p className="text-xs text-amber-700">
            Taux introuvable automatiquement (hors-ligne ou service indisponible). Saisissez-le manuellement :
          </p>
        )}
        {newCurrency !== profile.defaultCurrency && (
          <div>
            <label className="label" htmlFor="manualRate">
              1 {profile.defaultCurrency} = ? {newCurrency}
            </label>
            <input
              id="manualRate"
              type="number"
              step="0.0001"
              className="input"
              value={manualRate}
              onChange={(e) => setManualRate(Number(e.target.value))}
            />
          </div>
        )}
        {currencyMessage && <p className="text-sm text-brand-700">{currencyMessage}</p>}
        <button
          className="btn-primary"
          onClick={handleApplyCurrency}
          disabled={currencyBusy || newCurrency === profile.defaultCurrency}
        >
          {currencyBusy ? "Conversion…" : "Appliquer le changement de devise"}
        </button>
      </section>

      <section className="card space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
          <Bell className="h-4 w-4" /> Notifications (section 6)
        </h2>
        <div>
          <label className="label" htmlFor="threshold">
            Seuil d&apos;alerte global par défaut (%)
          </label>
          <div className="flex gap-2">
            <input
              id="threshold"
              type="number"
              min={1}
              max={100}
              className="input"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
            <button className="btn-secondary" onClick={handleThresholdSave}>
              Enregistrer
            </button>
          </div>
        </div>
        <div>
          {pushState === "granted" ? (
            <p className="text-sm text-brand-700">Notifications push activées sur cet appareil.</p>
          ) : pushState === "unsupported" ? (
            <p className="text-sm text-neutral-500">
              Les notifications push ne sont pas prises en charge par ce navigateur.
            </p>
          ) : (
            <button className="btn-primary" onClick={handleEnablePush}>
              Activer les notifications push sur cet appareil
            </button>
          )}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">Vos données</h2>
        <button className="btn-secondary w-full" onClick={handleExportData}>
          <Download className="h-4 w-4" /> Exporter toutes mes données (JSON)
        </button>
      </section>

      <section className="card space-y-3 border-red-200">
        <h2 className="text-sm font-semibold text-red-700">Zone dangereuse</h2>
        <p className="text-xs text-neutral-500">
          La suppression de votre compte est définitive et immédiate (9.4). Vos données sont exportées
          automatiquement avant suppression.
        </p>
        <label className="label" htmlFor="deleteConfirm">
          Tapez SUPPRIMER pour confirmer
        </label>
        <input
          id="deleteConfirm"
          className="input"
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
        />
        <button
          className="btn-danger w-full"
          disabled={deleteConfirmText !== "SUPPRIMER" || deleting}
          onClick={handleDeleteAccount}
        >
          <Trash2 className="h-4 w-4" /> {deleting ? "Suppression…" : "Supprimer définitivement mon compte"}
        </button>
      </section>

      <button className="btn-secondary" onClick={() => signOut().then(() => router.push("/login"))}>
        <LogOut className="h-4 w-4" /> Se déconnecter
      </button>

      <p className="text-center text-xs text-neutral-400">
        <a href="/legal/cgu" className="hover:underline">
          Conditions d&apos;utilisation
        </a>{" "}
        ·{" "}
        <a href="/legal/confidentialite" className="hover:underline">
          Politique de confidentialité
        </a>
      </p>
    </div>
  );
}
