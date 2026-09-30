"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    // Le lien reçu par email a déjà établi une session temporaire côté client via
    // Supabase Auth ; on peut donc mettre à jour le mot de passe directement.
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError("Ce lien de réinitialisation n'est plus valide. Demandez-en un nouveau.");
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  if (done) {
    return (
      <div>
        <h2 className="mb-2 text-lg font-semibold">Mot de passe mis à jour</h2>
        <p className="text-sm text-neutral-600">Redirection vers votre tableau de bord…</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Choisir un nouveau mot de passe</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="password">
            Nouveau mot de passe
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Confirmer le mot de passe
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Mise à jour…" : "Mettre à jour le mot de passe"}
        </button>
      </form>
    </div>
  );
}
