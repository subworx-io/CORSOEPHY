# Report + Block

## Problem
Corso hat aktuell keinen Weg, unangemessene Inhalte zu melden oder unangenehme Nutzer loszuwerden. Für den Freundes-Pilot gerade noch tragbar, für den zahlenden **Fremden-Pilot** ein Blocker: ohne Melde- und Block-Funktion fehlt die Grundlage von Sicherheit und Vertrauen, sobald sich Fremde begegnen. Wer sich in einem Moment unwohl fühlt, muss **sofort** handeln können.

## Evidence
- Annahme (Sicherheits-Grundausstattung) — abgeleitet aus der Produkt-Stufung (Fremden-Pilot mit €9/Monat nach dem Freundes-Pilot, `CLAUDE.md`). Trust & Safety ist Voraussetzung, keine Kür.
- Vorhandener Andockpunkt: Der Einstellungen-Screen hat die „Blockierte"-Sektion bereits als Platzhalter (`src/routes/settings.tsx`) — das Feature ist eingeplant, nur unbefüllt.

## Users
- **Primär**: Pilot-Nutzer, der sich bei einem Moment unwohl fühlt und in ≤ 2 Taps melden und/oder blockieren will.
- **Sekundär**: Maxim / Betreiber, der gemeldete Inhalte manuell sichtet (kein Dashboard nötig im Pilot).
- **Nicht für**: automatisierte Moderation, Community-Moderatoren.

## Hypothesis
Wir glauben, dass **ein unaufdringlicher Melde-Einstieg auf jedem Moment plus serverseitig durchgesetztes Blockieren** das **Sicherheits-/Vertrauens-Defizit vor dem Fremden-Pilot** löst.
Wir wissen, dass wir richtig liegen, wenn **Nutzer in ≤ 2 Taps melden/blockieren können, ein blockierter User serverseitig keinerlei Inhalte des Blockierenden mehr laden kann, und Reports beim Betreiber sichtbar landen** — ohne dass die bestehenden Sichtbarkeits- und Verfallsregeln brechen.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Erreichbarkeit | Melden UND Blockieren in ≤ 2 Taps ab Moment | Manueller Klickpfad-Test in Discovery / Ich folge / Stadt-Story |
| Server-Durchsetzung Block | 0 Inhalte des Blockierenden für den Blockierten ladbar | Negativ-Test (analog `scripts/security-test-*.mjs`): geblockter User fragt Posts direkt ab → keine Zeile |
| Report-Vertraulichkeit | Kein Lesepfad für andere User | RLS-Test: fremder User kann `reports` nicht lesen |

## Scope
**MVP**

**Daten & Server-Durchsetzung (Milestone 1)**
- **Tabelle `reports`**: `id`, `reporter_id (→ profiles)`, `reported_user_id (→ profiles)`, `reported_post_id (→ posts, nullable)`, `reason text` (Enum-check: `inappropriate` | `harassment` | `spam` | `other`), `note text null`, `status text` (`open` | `handled`, default `open`), `created_at`.
  - Weil Momente nach 24 h verschwinden: beim Report **denormalisierten Kontext** mitschreiben (z. B. `reported_media_path`, `reported_handle` als Snapshot), damit der Betreiber den gemeldeten Inhalt noch sichten kann, wenn der Post längst weg ist.
  - RLS: **Insert nur eigener Report** (`reporter_id = auth.uid()`), **keine Client-Lese-Policy** → nur `service_role`/SQL sieht Reports. Kein Leak-Pfad.
- **Tabelle `blocks`**: `id`, `blocker_id (→ profiles)`, `blocked_id (→ profiles)`, `created_at`, `unique (blocker_id, blocked_id)`, `check (blocker_id <> blocked_id)`.
  - RLS: Blocker liest/schreibt/löscht **nur eigene** Zeilen (für die Einstellungs-Liste + Entblocken). Der Blockierte sieht die Block-Zeile **nie** (still/einseitig).
- **Serverseitige Block-Durchsetzung (zusätzlicher Filter, bricht nichts Bestehendes)**:
  - Sichtbarkeit von `posts` (Discovery, Ich folge, Stadt-Story) wird per RLS/Filter um einen **bidirektionalen** Ausschluss ergänzt: existiert ein Block in irgendeiner Richtung zwischen Betrachter und Autor, ist der Post unsichtbar. Kommt **obendrauf** auf `expires_at > now()` und die bestehende Sichtbarkeitslogik.
  - **Gegenseitige Follows auflösen**: beim Blockieren werden Follows in beiden Richtungen zwischen den beiden entfernt.
  - **Anstupsen unterbinden**: Nudge-Insert wird verweigert, wenn ein Block (in einer der Richtungen) besteht.

**Report-UX (Milestone 2)**
- Auf **jedem Moment** (Discovery, Ich folge, Stadt-Story) ein unaufdringlicher Einstieg (kleines Menü / Overflow).
- Melde-Flow: Grund-Auswahl (`inappropriate` | `harassment` | `spam` | `other`) + optionales Freitextfeld → absenden. Schreibt server-seitig in `reports`.
- „Blockieren"-Aktion direkt aus dem Report-Flow **und** aus dem Moment-Menü erreichbar.

**Block-UX (Milestone 3)**
- Blockieren aus Moment-Menü / Report-Flow (≤ 2 Taps), still (keine Benachrichtigung des Blockierten).
- Einstellungen → „Blockierte"-Sektion: eigene Blocks listen + entblocken.

**Out of scope**
- Moderations-Dashboard / Workflow-Tooling — Betreiber geht `reports` manuell per SQL durch.
- Automatische Moderation, Meldeschwellen, Auto-Sperren.
- Benachrichtigung des gemeldeten/blockierten Users, Einspruchs-/Appeal-Flow.
- Chat-Teardown bei Block (Phase 3) — hier nur als Anforderung vermerkt, Chat existiert noch nicht.

🔒 **Leitplanken-Erhalt (nicht verhandelbar)**
- Block ist **serverseitig** durchgesetzt (RLS/Query-Filter), nie nur Frontend-Ausblendung.
- Der Block-Filter **ergänzt** die bestehende Sichtbarkeits- und 24h-Verfallslogik, ersetzt/bricht sie nicht.
- `reports` ist **write-only für Nutzer**, lesbar nur für den Betreiber (`service_role`).
- Follower-Zahlen / private Daten bleiben unsichtbar; der Block-Filter darf keinen neuen Lesepfad öffnen.

## Delivery Milestones
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Daten + Server-Durchsetzung | reports/blocks-Tabellen, RLS, bidirektionaler Post-Filter, Follow-Auflösung, Nudge-Sperre | pending | — |
| 2 | Report-UX | Melde-Einstieg auf jedem Moment, Grund + Freitext, schreibt in reports | pending | — |
| 3 | Block-UX | Blockieren aus Moment/Report (≤ 2 Taps) + Einstellungen-Sektion (Liste/Entblocken) | pending | — |

## Open Questions
- [ ] Gilt der Block-Filter auch für den neuen Gemeinschafts-Zähler (`city_moment_counts()`, SECURITY DEFINER → umgeht RLS)? Vorschlag: nein, die Stadtzahl bleibt ein unpersönliches Aggregat.
- [ ] Snapshot-Umfang beim Report: reicht `media_path` + `handle`, oder soll auch eine signierte Kopie/Referenz gesichert werden, falls Storage-Objekt gelöscht wird?
- [ ] Soll ein bereits gemeldeter/geblockter Zustand im Moment-Menü sichtbar sein („bereits gemeldet"), oder bewusst zustandslos?
- [ ] Rate-Limit gegen Report-Spam nötig (z. B. 1 Report pro (reporter, post))? Für den Freundes-Pilot evtl. verzichtbar.
- [ ] Wo genau lebt der Block-Filter technisch — RLS-Policy auf `posts`/`city_story_slots` vs. Query-Filter in den Hooks? (Entscheidung im `/plan`.)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Block nur im Frontend → Blockierter lädt Inhalte doch | Niedrig | Hoch | Durchsetzung als RLS/Server-Filter; Negativ-Test wie `security-test-*.mjs` |
| Block-Filter bricht bestehende Sichtbarkeit/Verfall | Mittel | Hoch | Filter additiv formulieren (`AND not blocked`); Regressionstest gegen Discovery/Story/Ich-folge |
| Gemeldeter Moment verfällt vor Sichtung → Betreiber sieht nichts | Hoch | Mittel | Denormalisierter Snapshot (media_path/handle) im Report |
| Reports lesbar für andere User | Niedrig | Hoch | RLS ohne Lese-Policy; nur service_role |
| Follow-Auflösung/Nudge-Sperre übersehen → „Geist"-Verbindung bleibt | Mittel | Mittel | Beim Block atomar in einer Transaktion/Funktion: Follows löschen + Block setzen |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
