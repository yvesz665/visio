"use client";

/**
 * Contexte d'authentification : expose l'utilisateur Supabase courant et relie le
 * jeton de session au moteur de synchronisation (src/lib/sync/engine.ts), qui en a
 * besoin pour authentifier ses appels à /api/sync/*.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { setAuthTokenProvider, scheduleSync } from "@/lib/sync/engine";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    setAuthTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session) void scheduleSync();
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) void scheduleSync();
    });

    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
      setSession(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé sous <AuthProvider>.");
  return ctx;
}
