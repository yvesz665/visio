"use client";

import { useEffect, type ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { initNetworkListeners, scheduleSync } from "@/lib/sync/engine";

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    const cleanupNetwork = initNetworkListeners();

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("[sw] échec d'enregistrement du service worker", err);
      });
    }

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "TRIGGER_SYNC") void scheduleSync();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    return () => {
      cleanupNetwork();
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  return <AuthProvider>{children}</AuthProvider>;
}
