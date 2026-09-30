# Architecture de Visio

Ce document justifie les choix techniques structurants, en particulier le point que le
cahier des charges (section 10.3) demandait explicitement de réévaluer : la pertinence de
Next.js + Supabase face à l'exigence de mode hors-ligne réel (section 10.2).

## 1. Le problème : Supabase seul ne suffit pas pour du hors-ligne réel

Le cahier des charges est explicite : « L'utilisateur doit pouvoir consulter son budget et
saisir une transaction sans connexion internet. Les données saisies hors-ligne se
synchronisent automatiquement dès que la connexion est rétablie. [...] pris en compte dès
la conception de l'architecture (stockage local, gestion des conflits) et non ajouté après
coup. »

Le SDK client de Supabase (`@supabase/supabase-js`) est conçu pour un client **toujours
connecté** : chaque `insert()`/`update()`/`select()` est un appel HTTP direct à PostgREST.
Hors-ligne, cet appel échoue simplement — il n'existe ni cache local, ni file d'attente
d'écritures, ni résolution de conflits intégrée au SDK. Brancher l'UI directement sur ce
SDK (la lecture naïve de la piste évoquée en 10.3) aurait rendu la saisie hors-ligne
impossible sans reconstruire nous-mêmes toute cette couche par-dessus — autant la
construire proprement dès le départ.

## 2. Décision : garder Next.js + Supabase, changer le câblage

**Next.js et Supabase sont conservés** (cohérent avec Skany, écosystème déjà connu du
porteur de projet, offre gratuite généreuse, Auth + Postgres + Storage inclus). Ce qui
change, c'est **comment** l'application leur parle :

- **IndexedDB (via [Dexie.js](https://dexie.org)) est la source de vérité côté client.**
  Toute lecture et toute écriture de l'UI passe par là, en ligne comme hors-ligne. Voir
  `src/lib/db/dexie.ts` et `src/lib/db/repository.ts`.
- **Chaque mutation est aussi enregistrée comme un événement dans un journal local**
  (`journal_events`), avec un id généré côté client (UUID) et un instantané "avant/après"
  suffisant pour l'annuler. Voir `src/lib/db/repository.ts` et `src/lib/domain/journal.ts`.
- **Un moteur de synchronisation** (`src/lib/sync/engine.ts`) rejoue les événements non
  synchronisés vers nos propres routes API Next.js (`/api/sync/push`, `/api/sync/pull`)
  dès que la connexion revient (événement `online`, tentative périodique, message du
  service worker). Le serveur applique chaque événement de façon **idempotente** (id
  unique) et **revalide les règles métier** (ex: la règle d'allocation 3.3) avant de
  l'accepter ou de le rejeter.
- **Le SDK Supabase n'est utilisé côté navigateur que pour l'authentification**
  (`src/lib/supabase/client.ts`) — un usage pour lequel il est adapté, puisque
  Supabase Auth gère déjà sa propre persistance de session locale. Les données
  budgétaires, elles, ne transitent jamais par un appel direct du navigateur à
  PostgREST.

### Pourquoi ce choix plutôt qu'un moteur de sync tiers (RxDB, PowerSync, ElectricSQL) ?

Ces outils résolvent un problème proche mais ajoutent soit un service hébergé
supplémentaire (PowerSync, ElectricSQL), soit une dépendance lourde avec des
fonctionnalités premium payantes (RxDB) — un coût disproportionné pour un projet gratuit
et solo. Surtout : le cahier des charges **exige déjà** un journal d'activité complet
doublant comme mécanisme d'annulation (section 5). Un journal d'événements horodaté,
rejouable, est *exactement* ce dont un mécanisme de synchronisation hors-ligne a besoin.
Plutôt que deux systèmes séparés (un journal d'audit + un moteur de sync tiers), Visio
n'en a qu'un seul qui sert les deux besoins — plus simple, plus facile à auditer, et
directement aligné avec une exigence fonctionnelle déjà posée par le document.

## 3. Comment le mode hors-ligne fonctionne concrètement

1. L'utilisateur ouvre l'app (PWA installée ou navigateur). Le service worker
   (`src/sw/service-worker.ts`, généré par [Serwist](https://serwist.pages.dev)) sert
   l'app shell depuis le cache même sans réseau.
2. Toutes les données déjà synchronisées une fois sont dans IndexedDB : le tableau de
   bord, les enveloppes, l'historique des transactions restent consultables hors-ligne.
3. Une saisie hors-ligne (nouvelle transaction, création d'enveloppe...) est appliquée
   immédiatement en local (via `src/lib/db/repository.ts`) et journalisée avec
   `syncStatus: "pending"`.
4. Au retour du réseau (`window.addEventListener("online", ...)`, message du service
   worker via l'API Background Sync quand disponible, ou vérification périodique), le
   moteur de synchronisation pousse les événements en attente, puis récupère les
   événements produits ailleurs (autre appareil, ou par le job planifié des récurrences)
   via `/api/sync/pull`.
5. Le serveur fait autorité : le client applique les instantanés ("snapshots") renvoyés
   tels quels plutôt que de rejouer des diffs, ce qui simplifie la gestion des conflits.
   Un événement rejeté (ex : la fratrie dépasserait le parent une fois fusionnée avec des
   changements faits ailleurs) est marqué `rejected` avec une raison ; le client peut
   alors informer l'utilisateur et re-synchroniser l'état réel de l'entité concernée.

### Cas multi-appareils

Un même compte utilisé sur plusieurs appareils (téléphone + ordinateur) est pris en
charge : un nouvel appareil qui se connecte pour la première fois reçoit un instantané
complet de toutes les données existantes (voir la branche "bootstrap" de
`/api/sync/pull`), pas seulement les événements qu'il aurait "ratés" — indispensable
puisque le budget général et les enveloppes créées pendant l'onboarding ne correspondent
à aucun événement que ce nouvel appareil aurait pu manquer.

**Limite assumée pour la v1** : la résolution de conflit entre deux appareils modifiant la
*même* enveloppe en étant simultanément hors-ligne est simplifiée (dernier écrit gagne au
niveau de chaque champ, avec revalidation serveur des règles d'allocation). Le cahier des
charges exclut explicitement le partage de budget entre plusieurs utilisateurs (2.3) ; le
seul scénario concurrent possible est donc un utilisateur unique sur deux de ses propres
appareils, un cas rare et à faible enjeu pour une app de budget personnel.

## 4. Autres choix notables

- **Postgres fait autorité pour les règles métier critiques** : la contrainte
  d'allocation (3.3) est appliquée par un trigger Postgres (`supabase/migrations/0001_init.sql`)
  en plus d'une validation identique côté client (`src/lib/domain/envelopes.ts`) — le
  client donne un retour instantané hors-ligne, le serveur reste le garant final en cas
  de fusion multi-appareils.
- **Notifications push (section 6)** : Web Push (VAPID), indépendant de Supabase, envoyé
  depuis le serveur au moment où un événement de transaction est appliqué (croisement de
  seuil détecté par comparaison avant/après, `src/lib/notifications/threshold-check.ts`)
  et par le job planifié des récurrences (`/api/cron/recurrences`).
- **Export CSV/PDF (section 8)** : généré entièrement côté client à partir d'IndexedDB
  (`src/lib/export/`), donc disponible même hors-ligne.
- **PWA** : [Serwist](https://serwist.pages.dev) (successeur maintenu de next-pwa) pour
  le service worker et le pré-cache de l'app shell ; `public/manifest.json` pour
  l'installabilité.

## 5. Sécurité résiduelle connue

`npm audit` signale une dépendance interne de Next.js 15 (`postcss`, un outil de
build) encore vulnérable au moment de la rédaction ; la corriger nécessite de passer à
Next.js 16, une montée de version majeure volontairement différée pour ne pas introduire
de risque de régression non vérifié en fin de développement. À réévaluer avant mise en
production publique.
