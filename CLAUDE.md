# CLAUDE.md

## Was wird hier gebaut

**Corso** ist eine lokale Stadtbeobachtungs-App mit Dating-Ausgang.
Jeden Abend "geht deine Stadt gemeinsam spazieren": rohe, ungeschnittene Video-Momente echter Menschen aus der Umgebung. Um 20:00 Uhr kann jeder Nutzer zufällig ins stadtweite Rampenlicht gezogen werden. Publikum verfällt nach 24 Stunden wenn man nicht nachliefert.

**Pilot:** Düsseldorf, **PWA** (kein Telegram, keine native App). Zwei Schritte: zuerst gratis Freundes-Pilot (20–30 Freunde, misst ob der Loop zieht), danach zahlender Fremden-Pilot (60–100 Mitglieder, €9/Monat, 4–6 Wochen).
**Eigner:** Maxim.

## Start hier (Lese-Reihenfolge für jeden neuen Kontext)

Vor dem Arbeiten der Reihe nach lesen — die Docs sind die Source of Truth, nicht dieses Gedächtnis:

1. **`CLAUDE.md`** (diese Datei) — Konventionen, Leitplanken, Stack.
2. **`docs/PRD.md`** — was & warum. Produkt-Source-of-Truth. Bei jedem Konflikt gewinnt das PRD.
3. **`docs/ROADMAP.md`** — was als nächstes & in welcher Reihenfolge (nach Abhängigkeit, Phase 0 blockt alles).
4. **`docs/STATUS.md`** — wo genau stehen wir gerade, was ist WIP, nächster konkreter Schritt. **Bei jedem nennenswerten Fortschritt aktualisieren.**

Regel: keine `[ENTSCHEIDUNG OFFEN]` stillschweigend treffen, keine 🔒 LEITPLANKE umgehen — eskalieren.

## Setup & Befehle

```bash
bun install                 # Abhängigkeiten
cp .env.example .env         # .env mit echten Werten befüllen (siehe .env.example)
bun run dev                  # Dev-Server (http://localhost:3000)
bun run dev:mobile           # Dev-Server + ngrok für iPhone-/Kamera-Tests (HTTPS)
bun run build                # Production Build
bun run preview              # Build lokal vorschauen
bun run lint                 # ESLint
bun run format               # Prettier (semi: true, double quotes, printWidth 100)
node scripts/db-apply.mjs    # Supabase-Migrationen aus supabase/migrations/ anwenden
```

- **Live-Kamera braucht HTTPS** — auf dem Handy nur über `dev:mobile` (ngrok) testbar, nicht über `http://<lan-ip>`.
- Test-Framework ist noch nicht konfiguriert. Es gibt Security-Smoke-Tests unter `scripts/security-test-*.mjs`.

### Kern-Mechaniken (nicht verhandelbar)
- 🔒 Live-Kamera-Pflicht — kein Galerie-Upload, keine Filter
- 🔒 Follower-Zahlen sind für andere unsichtbar
- 🔒 Kein Publikums-Verfall durch Zahlung verlängerbar
- 🔒 Einwilligung pro Clip ob Stadt-Story-fähig
- Verfallendes Publikum: Follow = 24h, danach aktiver Re-Entscheid
- Verdienter Chat: erst nach 3–4 gegenseitigen Clip-Austauschen

## Stack

- **Framework:** TanStack Start + React 19
- **Build:** Vite + Bun
- **Routing:** TanStack Router (file-based, `src/routes/`)
- **Data fetching:** TanStack Query
- **UI:** shadcn/ui + Radix UI + Tailwind CSS v4
- **Forms:** React Hook Form + Zod
- **Icons:** Material Symbols Outlined (Google Fonts)
- **Charts:** Recharts
- **Backend:** Supabase (Auth + Postgres + Storage + Cron) — Client/Server unter `src/lib/supabase/`, Schema in `supabase/migrations/`
- **Sprache:** TypeScript (strict)
- **Package manager:** Bun

> Stand: Das Supabase-Backend ist integriert (Auth, RLS, Follows-Verfall, Stadt-Story-Ziehung, Media-Upload). Reine Demo-Daten leben nur noch in `city-backdrop.tsx` und `story-empty-lab.tsx`.

## Dateistruktur

```
CORSOEPHY/
├── docs/
│   ├── PRD.md                # Product Requirements (Source of Truth — was & warum)
│   ├── ROADMAP.md            # Bau-Reihenfolge nach Abhängigkeit (Phasen 0–3)
│   └── STATUS.md             # Lebender Schnappschuss: aktueller Stand + nächster Schritt
├── src/
│   ├── routes/               # file-based routing — siehe src/routes/README.md
│   │   ├── __root.tsx        # Root-Layout, BottomNav, QueryClientProvider
│   │   ├── index.tsx         # Discovery-Screen (Entdeckungs-Feed, Swipe vertikal)
│   │   ├── record.tsx        # Aufnahme-Screen (Live-Kamera + Prompt)
│   │   ├── story.tsx         # Stadt-Story (20:00 Ritual, Swipe vertikal — UX/Optik wie Discovery, PRD 4.6 §5)
│   │   ├── story-empty-lab.tsx # Empty-/Loading-States der Story (Demo-Daten, isoliert)
│   │   ├── connections.tsx   # Verbindungen + verdienter Chat ("Korso")
│   │   ├── feedback.tsx      # Rücklauf (morgendliche Reichweite, privat)
│   │   ├── settings.tsx      # Einstellungen
│   │   └── impressum.tsx / datenschutz.tsx / agb.tsx  # Rechtstexte
│   ├── components/
│   │   ├── ui/               # shadcn/ui Komponenten (generiert, nicht anfassen)
│   │   └── *.tsx             # App-Komponenten (auth-gate, follow-button, dev-menu, …)
│   ├── hooks/                # use-mobile.tsx u.a.
│   ├── lib/
│   │   ├── supabase/         # Supabase Client (browser) + Server + Typen + Upload
│   │   ├── auth-context.tsx  # Auth-State (Magic-Link)
│   │   ├── follow-context.tsx# Follow-State (24h-Verfall)
│   │   └── utils.ts
│   ├── assets/               # .asset.json Lovable-Assets
│   ├── styles.css            # Globale Tailwind-Styles
│   ├── router.tsx            # Router-Setup
│   ├── server.ts / start.ts  # Server- / App-Entry-Point
│   └── routeTree.gen.ts      # auto-generiert — nicht editieren
├── supabase/
│   ├── migrations/           # 0001…-*.sql — Schema, RLS, Cron-Jobs (Source of Truth fürs DB-Schema)
│   ├── seed/ · templates/    # Seed-Daten, Auth-E-Mail-Templates
├── scripts/                  # db-apply.mjs, dev-mobile.sh, deploy.sh, make-invites.mjs, security-test-*.mjs
├── public/
├── .claude/ · .cursor/rules/ # AI-Assistenten- / Cursor-Regeln
└── ...config files (.env.example, vite.config.ts, tsconfig.json, …)
```

## Konventionen

- **Sprache im Code:** Englisch (Variablen, Funktionen, Typen)
- **Sprache UI-Text:** Deutsch (alle sichtbaren Texte sind auf Deutsch)
- **Sprache Antworten:** Deutsch
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:` etc.)
- Neue Routen → immer als Datei in `src/routes/` (TanStack file-based routing)
- Neue UI-Komponenten → zuerst prüfen ob shadcn/ui-Komponente vorhanden
- Keine hartcodierten Farben — Tailwind-Klassen oder CSS-Variablen
- Keine Follower-Zahlen oder Publikumsgröße für andere Nutzer sichtbar machen

## Was du NICHT tun sollst

- `git commit` und `git push` nur nach ausdrücklicher Rückfrage — niemals ungefragt
- Kein Deployment
- Keine neuen npm/bun-Abhängigkeiten ohne Rückfrage
- Keine Architektur-Entscheidungen ohne Absprache
- Keine `.env`-Datei anlegen oder befüllen ohne explizite Anweisung
- Keine der 🔒 LEITPLANKEN aus dem PRD umgehen oder weichspülen
- Keine Dummy-Daten in produktive Endpoints schreiben
- Kein Galerie-Upload implementieren (egal wie klein der Scope klingt)
