"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (signUpError) {
      setError(traduireErreur(signUpError.message));
      return;
    }
    // 9.2 : l'inscription enchaîne directement sur le parcours d'accueil guidé, jamais
    // sur un tableau de bord vide.
    router.push("/onboarding");
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Créer un compte</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Adresse email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Mot de passe
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-xs text-neutral-500">8 caractères minimum.</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Création…" : "Créer mon compte"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-neutral-500">
        Déjà un compte ?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}

function traduireErreur(message: string): string {
  if (message.toLowerCase().includes("already registered")) {
    return "Un compte existe déjà avec cette adresse email.";
  }
  if (message.toLowerCase().includes("password")) {
    return "Mot de passe invalide (8 caractères minimum).";
  }
  return "Une erreur est survenue. Réessayez.";
}
