/**
 * Garde d'authentification pour les routes protégées. Redirige vers /login si aucune
 * session Supabase valide n'est trouvée. Les pages elles-mêmes restent responsables de
 * lire/écrire les données via IndexedDB (le middleware ne fait que protéger l'accès aux
 * routes, il n'intervient jamais dans le chemin de lecture/écriture hors-ligne).
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/legal"];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const isPublic =
    PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p)) ||
    request.nextUrl.pathname === "/";

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            response.cookies.set(name, value);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|api/).*)"],
};
