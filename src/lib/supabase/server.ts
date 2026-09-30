/**
 * Client Supabase côté serveur, utilisé dans les Route Handlers Next.js (src/app/api/**).
 *
 * Deux variantes :
 *  - `createServerClientFromCookies()` : lie le client à la session de l'utilisateur
 *    courant (cookies), pour que les policies RLS ("user_id = auth.uid()") s'appliquent
 *    naturellement — c'est la variante utilisée par les routes de synchronisation, afin
 *    qu'un utilisateur ne puisse jamais lire/écrire les données d'un autre.
 *  - `createServerClientFromBearerToken(token)` : variante pour les appels du moteur de
 *    synchronisation qui envoie le token d'accès en en-tête Authorization plutôt que via
 *    cookie (plus simple à piloter depuis le service worker / fetch en tâche de fond).
 *  - `createServiceRoleClient()` : accès complet, réservé aux jobs planifiés serveur
 *    (déclenchement des récurrences, envoi de notifications push) qui doivent agir pour
 *    tous les utilisateurs. Ne jamais exposer cette clé au client.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function createServerClientFromCookies() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // appelé depuis un contexte où l'écriture de cookies n'est pas autorisée
            // (Server Component) : sans effet, la session sera rafraîchie via le middleware.
          }
        },
      },
    }
  );
}

export function createServerClientFromBearerToken(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createServiceRoleClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
