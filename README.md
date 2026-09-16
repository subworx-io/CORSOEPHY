# Corso

**Lokale Stadtbeobachtungs-App mit Dating-Ausgang.**

Deine Stadt geht spazieren: rohe, ungeschnittene Foto- und Video-Momente echter Menschen aus deiner Umgebung, aufgenommen nur mit der Live-Kamera. Jeder Moment lebt 24 Stunden. Auf der Bühne der Stadt — dem **Stadt Corso** — stehen feste Plätze, und sie läuft rund um die Uhr: wird ein Platz frei, rückt gewichtet der nächste Moment nach. Wer dort gefällt, gewinnt Publikum — aber jeder Follow verfällt 24 Stunden nach dem Follow, wenn man nicht nachliefert. Wer sich über Tage gegenseitig folgt, landet im **Circle**, und erst dort gibt es einen Chat.

> Dating ist der Ausgang, nicht der Eingang.

**Pilot:** Düsseldorf · PWA · zuerst gratis Freundes-Pilot, danach zahlender Fremden-Pilot (€9/Monat)
**Live:** https://corso-app.pages.dev

---

## Setup

```bash
git clone git@github.com:subworx-io/CORSOEPHY.git
cd CORSOEPHY

bun install

cp .env.example .env
# .env mit echten Werten befüllen

bun run dev
```

## Verfügbare Scripts

```bash
bun run dev          # Entwicklungsserver (http://localhost:3000)
bun run dev:mobile   # Dev-Server + ngrok (HTTPS) — nötig für die Kamera auf dem Handy
bun run build        # Production Build
bun run preview      # Build lokal vorschauen
bun run lint         # ESLint
bun run format       # Prettier
```

Lokal wird Bun genutzt, **CI/Release fährt npm** (`npm ci`) — wer `package.json` ändert, zieht beide Lockfiles nach. Release und Deploy: `docs/RELEASE.md`.

## Stack

- **Framework:** TanStack Start + React 19
- **Build:** Vite + Bun
- **UI:** shadcn/ui + Radix UI + Tailwind CSS v4
- **Routing:** TanStack Router (file-based)
- **Data:** TanStack Query
- **Backend:** Supabase (Auth, Postgres mit RLS, Storage, pg_cron)
- **Hosting:** Cloudflare Pages (Worker-SSR)

Details → `CLAUDE.md` und `.cursor/rules/stack.mdc`

## Screens

Bottom-Nav: **Stadt · Corso · Kamera · Circle · Du**

| Route | Screen |
|---|---|
| `/` | Stadt — Discovery (Fremde) ⇄ „Ich folge" per Toggle, vertikaler Swipe, eine Kachel pro Person |
| `/story` | Stadt Corso — die laufende Bühne mit festen Plätzen, vertikaler Swipe |
| `/record` | Kamera — Live-Kamera, Tippen = Foto, Halten = Video |
| `/circle` | Circle — beständige Partner-Leiste, Momente der Partner, Chat |
| `/feedback` | Du — private Bilanz zum eigenen Moment + Weg zu den Einstellungen |
| `/settings` | Einstellungen (bewusst minimal) |
| `/p/$handle` | Profil — nur als Ziel für Push und geteilte Links |

Die Momente einer Person blättert man direkt auf ihrer Kachel durch (Tipp rechts = weiter, linkes Drittel = zurück).

## Dokumentation

Lese-Reihenfolge zum Reinkommen:

1. `CLAUDE.md` — Konventionen und Leitplanken für AI-Assistenten (Einstieg)
2. `docs/PRD.md` — Product Requirements, Kern-Mechaniken, Pilot-Spezifikation (Source of Truth)
3. `docs/ROADMAP.md` — Bau-Reihenfolge nach Abhängigkeit (Phasen 0–3)
4. `docs/STATUS.md` — aktueller Stand + nächster konkreter Schritt

Weitere Dokumente:
- `docs/RELEASE.md` — Release per GitHub Actions, Migrations-Ledger
- `docs/PUSH-SETUP.md` — Web-Push einrichten und Fehlersuche
- `docs/SCROLL_NATIV_UMBAU.md` — nativer Scroll im Feed: Konzept und Umsetzung (live seit 16. Sep 2026)
- `.cursor/rules/` — Cursor IDE Regeln

## Kontakt

Dominik — tools@subworx.io
