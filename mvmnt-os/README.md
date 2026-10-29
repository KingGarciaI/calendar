# MVMNT OS

Calendrier interactif, gestion des tâches et des projets, et assistant IA capable de lire et de modifier réellement tes données. Application Web installable sur iPhone (PWA).

---

## État du projet (29 octobre 2026)

**Légende** — ✅ fonctionne et testé automatiquement · 🟡 construit, à valider sur ton appareil ou avec tes clés · ⬜ à faire

### Phase 1 — Application
| Fonctionnalité | État |
|---|---|
| Schéma Postgres, migrations versionnées, RLS sur chaque table | ✅ isolation testée entre deux comptes (lecture, écriture, liens croisés) |
| Authentification Supabase (mot de passe + lien magique) | 🟡 code prêt, à tester sur ton projet Supabase |
| Calendrier : vues jour / 3 jours (mobile) / semaine / mois / agenda | ✅ rendu testé |
| Créer, modifier, supprimer un événement ; lieu, notes, couleur, catégorie, projet, rappels | ✅ |
| Glisser-déposer et redimensionner un événement (avec « Annuler ») | ✅ logique serveur testée · 🟡 geste souris/tactile à valider |
| Événements récurrents (occurrence / suivants / série), changements d'heure | ✅ DST de Toronto testé |
| Détection de conflits + créneaux alternatifs | ✅ |
| Rendez-vous « ferme » (verrouillé) que l'IA ne peut pas déplacer | ✅ |
| Tâches : statut, priorité, échéance, durée, projet, catégorie, sous-tâches, notes, rappels, récurrence | ✅ |
| Vues tâches : échéance, priorité, projet, statut ; ajout rapide | ✅ |
| Glisser une tâche sur le calendrier → bloc de travail lié | ✅ serveur · 🟡 geste à valider |
| Terminer une tâche → synchronisé partout (listes, calendrier, projet) | ✅ |
| Projets : progression, tâches, échéances, événements liés, notes | ✅ |
| Tableau de bord (ruban de la journée, priorités, retards, à venir, projets) | ✅ |
| Page Aujourd'hui, recherche globale (⌘K), raccourcis clavier | ✅ |
| Thèmes clair / sombre / système (synchronisé au compte) | ✅ |
| Interface mobile (barre d'onglets, panneaux en feuille) | 🟡 à valider sur iPhone |
| Paramètres, catégories personnalisables, export JSON | ✅ |

### Phase 2 — Assistant IA
| Fonctionnalité | État |
|---|---|
| 22 outils (13 de lecture, 9 d'écriture) partagés avec l'app, validés par zod | ✅ |
| Création / modification réelles, recherche de disponibilités, planification de tâches | ✅ testé avec un modèle simulé |
| Confirmation obligatoire : suppressions, annulations, déplacements de rendez-vous | ✅ |
| Distinction proposé / exécuté / refusé / échec, journal d'audit `ai_actions` | ✅ |
| Dates relatives fiables (calendrier des 15 prochains jours injecté) | ✅ |
| Conversations sauvegardées, historique | ✅ |
| Appel réel à Claude (ou OpenAI) | 🟡 nécessite ta clé API |

### Phase 3 — PWA et rappels
| Fonctionnalité | État |
|---|---|
| Manifest, icônes, mode autonome, page hors ligne | ✅ |
| Moteur de rappels côté serveur (rendez-vous, échéances, résumé du matin, heures de silence) | ✅ testé, sans doublon |
| Notifications dans l'app (cloche) | ✅ |
| Web Push (abonnement par appareil, test) | 🟡 nécessite les clés VAPID et l'installation sur l'iPhone |
| Déclenchement chaque minute via Supabase pg_cron | 🟡 à activer (script fourni) |

### Phase 4 — Intelligence avancée
| | État |
|---|---|
| Classement des priorités, tâches en retard, tâches repoussées (`times_postponed`) | ✅ via l'assistant |
| Plan de journée proposé puis confirmé | ✅ via l'assistant |
| Serveur MCP sécurisé | ⬜ la couche d'outils (`lib/server/ai/tools.ts`) est prête à être exposée |
| Synchronisation Google Calendar, rappels par courriel | ⬜ |
| Planification automatique continue (style Motion) | ⬜ |

**Tests** : 31 tests automatisés (services, récurrence, assistant, rappels, interface) + 36 vérifications de bout en bout sur le serveur de production + script d'isolation RLS. Limite : aucun navigateur réel n'était disponible dans l'environnement de construction ; les gestes (glisser à la souris ou au doigt) et le rendu iPhone restent à vérifier à la main.

---

## Architecture

```
Navigateur / iPhone (PWA)
   │  fetch JSON
   ▼
Next.js 15 (Vercel) ── app/api/*  ← routes REST validées par zod
   │                     │
   │                     ▼
   │               lib/server/services/*   ← UNE seule couche métier
   │                     ▲          ▲
   │     assistant IA ───┘          └─── futur serveur MCP
   │     (lib/server/ai : outils + boucle + fournisseurs Claude/OpenAI)
   ▼
Supabase Postgres  — chaque requête tourne dans une transaction
                     « role authenticated + sub = utilisateur » → RLS appliquée
Supabase Auth      — session vérifiée côté serveur (getUser)
Supabase pg_cron   — appelle /api/cron/reminders chaque minute → Web Push
```

Choix notables :
- **Accès base** : le serveur se connecte à Postgres et applique explicitement l'identité de l'utilisateur dans chaque transaction (`set local role authenticated` + claims). La RLS protège donc l'app *et* l'assistant ; aucune clé `service_role` n'est utilisée.
- **Récurrences** calculées en heure locale puis converties : « chaque lundi 9 h » reste à 9 h après le changement d'heure.
- **Fournisseur d'IA** appelé par simple `fetch` (Claude Messages API ou OpenAI) : aucun SDK à maintenir, changement de fournisseur dans les paramètres.
- **Rappels** déclenchés par Supabase pg_cron (gratuit, chaque minute) plutôt que Vercel Cron (une fois par jour sur le plan gratuit).

---

## Mise en ligne — ce que tu dois faire

Compte environ 30 minutes. Coût : 0 $ sur les paliers gratuits de Supabase et Vercel, plus l'usage de l'API Claude.

### 1. Supabase
1. Crée un projet sur [supabase.com](https://supabase.com) (région **Canada (Central)**).
2. *Project Settings → API* : note `Project URL` et la clé `anon public`.
3. *Project Settings → Database → Connection string* : note la chaîne **Transaction pooler** (port 6543) et la chaîne **Session pooler** (port 5432).
4. Applique les migrations depuis ton ordinateur :
   ```bash
   npm install
   DATABASE_URL="<chaîne session pooler>" node scripts/migrate.mjs
   ```
   (Alternative : copie le contenu de `supabase/migrations/*.sql`, dans l'ordre, dans *SQL Editor*.)
5. Vérifie dans *SQL Editor* que le rôle de connexion peut endosser l'identité d'un utilisateur :
   ```sql
   select pg_has_role('postgres', 'authenticated', 'member');
   ```
   Si le résultat est `false` : `grant authenticated to postgres;`
6. *Authentication → Users → Add user* : crée ton compte (courriel + mot de passe).
7. *Authentication → Sign In / Providers → Email* : **désactive « Allow new users to sign up »** (application personnelle).
8. *Authentication → URL Configuration* : `Site URL` = ton URL Vercel ; ajoute `https://<ton-url>/auth/callback` aux Redirect URLs.

### 2. Clés
- **Claude** : crée une clé sur [console.anthropic.com](https://console.anthropic.com).
- **Notifications** : `npx web-push generate-vapid-keys` (une seule fois).
- **CRON_SECRET** : une longue chaîne aléatoire (`openssl rand -hex 32`).

### 3. Vercel
1. Pousse ce dossier sur un dépôt GitHub privé, puis *Add New → Project* sur Vercel.
2. Variables d'environnement (voir `.env.example`) :

| Variable | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé anon |
| `DATABASE_URL` | chaîne **transaction pooler** (6543) |
| `NEXT_PUBLIC_SITE_URL` | URL de production |
| `ANTHROPIC_API_KEY` | ta clé Claude |
| `AI_MODEL_ANTHROPIC` | `claude-sonnet-5-5` (optionnel) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | clés générées |
| `VAPID_SUBJECT` | `mailto:ton@courriel` |
| `CRON_SECRET` | ta chaîne aléatoire |

Ne mets **jamais** `MVMNT_DEV_AUTH` sur Vercel (le mode développement y est de toute façon désactivé).

3. Déploie, puis connecte-toi avec le compte créé à l'étape 1.6.

### 4. Rappels automatiques
Dans Supabase *SQL Editor*, exécute `supabase/cron-reminders.sql` après y avoir remplacé `<APP_URL>` et `<CRON_SECRET>`.

### 5. iPhone
1. Ouvre l'URL dans **Safari** → *Partager* → *Sur l'écran d'accueil*.
2. Ouvre MVMNT OS depuis l'icône → *Paramètres → Notifications → Activer sur cet appareil* → *Envoyer un test*.
(iOS 16.4 ou plus récent ; les notifications ne fonctionnent que depuis l'app installée, pas depuis un onglet Safari.)

---

## Développement local

Le mode développement permet de tout faire tourner sans projet Supabase, sur un Postgres local.

```bash
npm install
# Postgres local, puis :
DATABASE_URL=postgres://postgres:postgres@localhost:5432/mvmnt node scripts/migrate.mjs --with-test-shim
cp .env.example .env.local   # puis : DATABASE_URL local, MVMNT_DEV_AUTH=1, DEV_AUTH_SECRET (32+ caractères)
npm run dev
```
`--with-test-shim` recrée la petite partie de Supabase dont le schéma dépend (`auth.users`, `auth.uid()`, rôles). **Ne l'utilise jamais sur Supabase.**

### Tests
```bash
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/mvmnt   # base jetable
npm test                                                   # services, récurrence, assistant, rappels
psql "$TEST_DATABASE_URL" -f supabase/local-test/rls_test.sql   # isolation RLS
npm run build && npm start &                               # serveur avec MVMNT_DEV_AUTH=1
node tests/e2e-api.mjs                                     # 36 vérifications de bout en bout
MVMNT_TEST_URL=http://localhost:3000 npx vitest run tests/ui   # interface (jsdom, vraie API)
```

---

## Raccourcis clavier

| Touche | Action |
|---|---|
| ⌘K ou / | Recherche et commandes |
| N | Nouvelle tâche |
| E | Nouvel événement |
| A | Ouvrir / fermer l'assistant |
| 1 à 5 | Tableau de bord, Aujourd'hui, Calendrier, Tâches, Projets |
| Calendrier : T, ← →, D, W, M, L | Aujourd'hui, période précédente/suivante, vues |
| Échap | Fermer le panneau |

---

## Repères dans le code

| Dossier | Rôle |
|---|---|
| `supabase/migrations` | Schéma, index, RLS, déclencheurs |
| `lib/schemas.ts` | Validation zod partagée (API, formulaires, outils IA) |
| `lib/server/services` | Logique métier : événements, tâches, projets, disponibilités |
| `lib/server/ai` | Outils, boucle de l'assistant, fournisseurs |
| `lib/server/reminders.ts` | Moteur de rappels |
| `lib/recurrence.ts` | Récurrences en heure locale |
| `components/calendar` | Calendrier (FullCalendar, entièrement rethémé) |
| `app/api` | Routes REST |
