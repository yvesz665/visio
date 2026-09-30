/**
 * Client Supabase côté navigateur — utilisé UNIQUEMENT pour l'authentification
 * (inscription, connexion, réinitialisation de mot de passe) et l'upload de pièces
 * jointes vers Supabase Storage.
 *
 * Volontairement PAS utilisé pour lire/écrire les données budgétaires : voir
 * ARCHITECTURE.md pour la justification (le SDK Supabase suppose un client toujours
 * connecté, incompatible avec l'exigence de mode hors-ligne réel de la section 10.2).
 * Ces données passent par IndexedDB (src/lib/db) et le moteur de synchronisation
 * (src/lib/sync), qui appelle nos propres routes API.
 */

import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
