/// <reference lib="webworker" />
/**
 * Service worker de Visio : PWA installable (10.1) + mode hors-ligne (10.2) + réception
 * des notifications push (6). Le pré-cache de l'app shell (généré par Serwist à partir
 * de `self.__SW_MANIFEST`) permet à l'application de s'ouvrir et d'être utilisée --
 * consultation du budget, saisie de transactions -- même sans réseau ; les données elles
 * -mêmes vivent dans IndexedDB (voir src/lib/db), pas dans le cache HTTP.
 */

import { defaultCache } from "@serwist/next/worker";
import { Serwist } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

declare const self: ServiceWorkerGlobalScope &
  SerwistGlobalConfig & {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  };

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// --- Notifications push (section 6) -----------------------------------------------
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: { title: string; body: string; url?: string; tag?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Visio", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon.svg",
      badge: "/icons/icon.svg",
      tag: payload.tag,
      data: { url: payload.url ?? "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// --- Repli de synchronisation : quand le navigateur le permet (Background Sync API),
// tente une synchronisation dès que la connectivité est détectée par le SW lui-même.
self.addEventListener("sync", (event) => {
  const syncEvent = event as unknown as { tag: string; waitUntil: (p: Promise<unknown>) => void };
  if (syncEvent.tag === "visio-sync") {
    syncEvent.waitUntil(
      self.clients.matchAll().then((clientsArr) => {
        clientsArr.forEach((c) => c.postMessage({ type: "TRIGGER_SYNC" }));
      })
    );
  }
});
