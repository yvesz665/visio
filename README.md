# Visio

Application personnelle de gestion budgétaire en arborescence d'enveloppes, installable
comme une PWA et utilisable hors-ligne. Voir `docs/cahier-des-charges.docx` pour les
règles fonctionnelles complètes et `ARCHITECTURE.md` pour les choix techniques (en
particulier la justification du mode hors-ligne, demandée en section 10.3 du cahier des
charges).

## Pile technique

- **Next.js 15** (App Router, TypeScript) — front-end et routes API.
- **Dexie.js (IndexedDB)** — source de vérité locale, en ligne comme hors-ligne.
- **Supabase** — Postgres (persistance durable), Auth (email/mot de passe), Storage
  (pièces jointes). Jamais appelé directement par le navigateur pour les données
  budgétaires : voir `ARCHITECTURE.md`.
- **Serwist** — service worker (PWA installable, cache de l'app shell).
- **Recharts** — graphiques du tableau de bord.
- **web-push** — notifications push (VAPID).
- **jsPDF / jspdf-autotable** — export PDF.

## Mise en route

### 1. Dépendances

```bash
npm install
```

### 2. Créer un projet Supabase

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Dans **SQL Editor**, exécuter le contenu de `supabase/migrations/0001_init.sql`
   (schéma complet : tables, RLS, triggers de la règle d'allocation, fonction de
   conversion de devise, bucket de stockage `attachments`).
3. Dans **Authentication → Settings**, désactiver l'obligation de confirmer l'email
   avant connexion (« Confirm email » → off), conformément à la section 9.1 du cahier
   des charges : la vérification reste recommandée mais n'est pas obligatoire pour
   commencer à utiliser l'application.
4. Copier `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` et
   `SUPABASE_SERVICE_ROLE_KEY` depuis **Project Settings → API**.

### 3. Variables d'environnement

```bash
cp .env.example .env.local
```

Remplir les valeurs Supabase, puis générer les clés VAPID pour les notifications push :

```bash
npm run generate-vapid-keys
```

Copier la clé publique dans `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, la clé privée dans
`VAPID_PRIVATE_KEY`, et renseigner `VAPID_SUBJECT` (ex : `mailto:vous@exemple.com`).
Choisir aussi une valeur pour `CRON_SECRET` (chaîne aléatoire).

### 4. Lancer en développement

```bash
npm run dev
```

Le service worker est désactivé en développement (voir `next.config.mjs`) pour ne pas
gêner le rechargement à chaud ; testez le mode hors-ligne sur un build de production
(`npm run build && npm start`).

### 5. Job planifié des récurrences

`/api/cron/recurrences?secret=<CRON_SECRET>` doit être appelé au moins une fois par jour
(Vercel Cron, cron-job.org, ou tout scheduler externe) pour déclencher les transactions
récurrentes dues et créer les échéances en attente de confirmation en cas de budget
insuffisant (section 4.2).

### 6. Icônes de l'application

`public/icons/icon.svg` est un icône SVG minimal, placeholder. Pour une installation PWA
optimale sur toutes les plateformes (notamment iOS, qui exige un PNG pour l'icône
d'accueil), remplacez-le par un jeu d'icônes PNG (192×192, 512×512, et une variante
"maskable") avant la mise en production, et mettez à jour `public/manifest.json` et les
balises `icons` dans `src/app/layout.tsx` en conséquence.

## Scripts

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run start` | Sert le build de production |
| `npm run typecheck` | Vérification TypeScript sans émission |
| `npm run lint` | ESLint |
| `npm run test` | Tests unitaires (Vitest) — logique de domaine pure |
| `npm run generate-vapid-keys` | Génère une paire de clés VAPID pour le push |

## Structure du projet

```
src/
  app/                 Routes Next.js (App Router)
    (auth)/            Connexion, inscription, mot de passe
    (app)/             Tableau de bord, enveloppes, transactions, activité, réglages, export
    api/               Routes serveur : sync, onboarding, push, cron, suppression de compte
    legal/             CGU et politique de confidentialité
  components/          Composants UI réutilisables
  hooks/               Hooks React (auth, lecture réactive de la base locale)
  lib/
    db/                Dexie (schéma local) + repository (mutations + journal)
    domain/            Logique métier pure, testable indépendamment de l'UI/BDD
    sync/              Moteur de synchronisation hors-ligne
    supabase/          Clients Supabase (navigateur, serveur, mappers de lignes)
    notifications/     Web Push (client + serveur) et détection de seuil
    export/            CSV / PDF / export JSON complet
  sw/                  Source du service worker (Serwist)
  types/               Types de domaine partagés
supabase/migrations/   Schéma SQL (tables, RLS, triggers, fonctions)
tests/                 Tests unitaires de la logique de domaine
docs/                  Cahier des charges (copie de référence)
```

## Limites connues de cette v1

- Résolution de conflit multi-appareils simplifiée (dernier écrit gagne au niveau
  champ, avec revalidation serveur) — acceptable car le partage de budget entre
  utilisateurs est explicitement hors périmètre (section 2.3).
- Icônes PWA placeholder (SVG) à remplacer par un jeu PNG de production.
- Une dépendance interne de Next.js (`postcss`) reste signalée par `npm audit` ; voir
  `ARCHITECTURE.md §5`.
- CGU et politique de confidentialité rédigées mais à faire relire/compléter avant mise
  en public, comme demandé en section 15 du cahier des charges.
