"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);
    if (resetError) {
      setError("Impossible d'envoyer l'email pour le moment. Réessayez plus tard.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div>
        <h2 className="mb-2 text-lg font-semibold">Email envoyé</h2>
        <p className="text-sm text-neutral-600">
          Si un compte existe pour {email}, un lien de réinitialisation vient de lui être envoyé.
        </p>
        <Link href="/login" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
          Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Mot de passe oublié</h2>
      <p className="mb-4 text-sm text-neutral-600">
        Recevez un lien par email pour choisir un nouveau mot de passe (9.1).
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Adresse email
          </label>
          <input
            id="email"
            type="email"
            required
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Envoi…" : "Envoyer le lien"}
        </button>
      </form>
      <Link href="/login" className="mt-4 inline-block text-sm text-neutral-500 hover:underline">
        Retour à la connexion
      </Link>
    </div>
  );
}
