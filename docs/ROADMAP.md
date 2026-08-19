# Corso — Roadmap

**Version:** 0.2 (Stand 19. August 2026)
**Bezug:** Ergänzt das PRD (`docs/PRD.md`). Bei Konflikt gewinnt das PRD.
**Zweck:** Priorisierte Bau-Reihenfolge vom aktuellen Klick-Prototyp zu einem mit Freunden teilbaren MVP.

> **Agent-Hinweis:** Diese Roadmap ist nach Abhängigkeit sortiert, nicht nach Wunsch. Phase 0 blockt fast alles. Nicht an Phase 2/3 anfangen, solange Phase 0/1 nicht durch sind. Bei jeder `[ENTSCHEIDUNG OFFEN]` eskalieren, nicht stillschweigend entscheiden.

---

## Aktueller Stand (19. August 2026)

**Phase 0 ist abgeschlossen. Phase 1 ist zu ~60 % gebaut.**

Die App läuft live auf `https://corso-app.pages.dev`. Der komplette Kern-Loop läuft **ohne Mock**: posten → in Discovery erscheinen → folgen → in den Stadt Corso gezogen werden → private Zahl im Rücklauf. Alle 5 Kern-Screens plus ein minimaler Einstellungen-Screen (Screen 10) und drei Rechts-Platzhalterseiten existieren.

**Am 19. August gegen die Live-DB verifiziert:** Alle drei Server-Jobs laufen mit echten Daten — der Stadt Corso wurde am 1., 2. und 13. August real um 20:00 Berlin aus echten einwilligenden Momenten gezogen; der Reichweiten-Snapshot lief zuletzt heute Morgen; der Follow-Verfall stempelte zuverlässig um 08:00. **Überholt seit 19. August abends:** der 08:00-Reset ist durch den individuellen 24h-Verfall ersetzt, die Ziehung läuft um 21:00 (`0015_rolling_24h_expiry.sql`).

**Es fehlt in Phase 1:** Infinite Scroll in der Discovery und Push-Notifications.
**Noch gar nicht gebaut:** verdienter Chat (Phase 3), Metrik-Tracking und Report/Block (Phase 2).

> ⚠️ **Der Freundes-Pilot hat noch nicht begonnen.** Die `invites`-Tabelle ist leer, und das Cloudflare-Secret zum Einlösen der Einladungs-Links ist nicht gesetzt — der Haupt-Onboarding-Weg ist damit funktionsunfähig. Es gibt entsprechend **kein einziges Signal zu den Kill-Metriken.** Details und Befehle in `docs/STATUS.md`.

> Tagesaktueller Detail-Stand und die konkreten nächsten Schritte → `docs/STATUS.md`.

---

## Grundsatzentscheidungen (ENTSCHIEDEN)

| # | Entscheidung | Ergebnis |
|---|---|---|
| G1 | **Pilot-Tooling** | **PWA.** ✓ Telegram fallen gelassen. Die echte Live-Kamera ist bereits in der PWA umgesetzt. |
| G2 | **Pilot-Modell** | **Freundes-Pilot gratis.** ✓ Misst sauber, ob der Loop zieht. Zahlender Fremden-Pilot bleibt späterer zweiter Schritt. |
| G3 | **Pilot-Stadt** | **Düsseldorf.** ✓ Wohnort des Gründers → Concierge-Nähe gegeben. |

> **Folge für das PRD:** Die PRD-Zeile „Telegram-Bot, keine native App" (§9), das „Live-Kamera im Telegram-Bot"-Spannungsfeld und die offene Entscheidung #9 sind damit hinfällig. In PRD v0.3 eingearbeitet.
>
> **Hinweis Geschäfts-Signal:** Der gratis Freundes-Pilot beweist NICHT das Geschäft (Freunde nutzen aus Gefälligkeit). Er beweist nur, ob der Loop zieht. Der zahlende Fremden-Pilot bleibt als separater zweiter Schritt nötig.

---

## Phase 0 — Backend-Fundament (blockt alles)

**Ziel:** Aus dem Solo-Klick-Prototyp wird eine zwischen mehreren Geräten geteilte App. Follow-State und Momente überleben Reload und sind serverseitig.

**Scope:**
- Auth (Magic-Link oder Telefonnummer, kein Passwort nötig).
- Persistenz für: User, Momente, Follows, Anstupser.
- Video-Upload + Storage + Auslieferung (der disabled „Verwenden"-Button wird funktional).
- ~~Der **08:00-Reset als echter Server-Job**~~ — **abgelöst am 19. August**: Verfall läuft ohne Job, rein über `expires_at > now()` pro Datensatz.
- Follow-Logik vom React-Context ins Backend migrieren (24h-Verfall, `canRenew` ab 12h). Serverseitig erzwungen ist seit `0015` der Verfall selbst (Trigger); die Anzeige-Logik lebt weiter im Context.

**Akzeptanzkriterien:**
- [x] Zwei verschiedene Handys sehen denselben geteilten Zustand. *(Datenebene 7. Juli verifiziert: Follows/Momente/Nudges serverseitig, kein localStorage mehr. Realer Zwei-Geräte-Test steht noch aus — hängt an der Login-Zustellung, siehe STATUS.)*
- [x] Ein hochgeladener Clip erscheint auf einem anderen Gerät in der Discovery. *(7. Juli: Upload + `posts`-Insert unter RLS verifiziert; Discovery lädt echte Posts, Mock-Fallback entfernt.)*
- [x] Follow überlebt App-Reload. *(7. Juli: `follow-context` lädt aktive Follows aus der DB statt aus Seeds/localStorage.)*
- [x] Follows verfallen serverseitig, ohne dass ein Client offen sein muss. *(Bis 19. Aug: pg_cron `expire-follows-daily`, `0003`. Seit `0015`: 24h ab Follow, per `expires_at` in jeder Query — der Cron ist ersatzlos entfallen.)*

**Phase 0 abgeschlossen (15. Juli):** Aufnahme-UI-Flow (Kamera→Upload) im echten Browser end-to-end verifiziert — aufgenommener Moment erscheint bei anderen Usern in Discovery. Damit ist auch der geräte-übergreifende Konsum-Loop real bestätigt. Die damals noch offene **Login-Mail-Zustellung** (Spam-Placement) ist ebenfalls gelöst — Magic-Link-Mails landen im Posteingang; für den Freundes-Pilot ist der Einladungs-Link ohnehin der Hauptweg.

**Bewusst NICHT in Phase 0:** ID-Verifizierung, Push, Algorithmus für den Stadt Corso, Chat.

---

## Phase 1 — Konsum-Loop end-to-end echt

**Ziel:** Die komplette Kern-Kette läuft mit echten Daten zwischen mehreren Geräten. Das ist der eigentliche Test.

**Die Kette:** Moment hochladen → erscheint in Discovery → folgbar → kann in Stadt Corso gezogen werden → Rücklauf zeigt echte Zahl → Push bringt zurück.

**Scope:**
- ✅ **Auswahl für den Stadt Corso als echter Mechanismus** (statt 8 Mock-Clips) — **erledigt 15. Juli** (`0005_city_story_draw.sql` live, `story.tsx` de-mockt, Details in `docs/STATUS.md`). Serverseitige gewichtete Zufallsziehung: `w = 1 + ln(1 + aktive_follower)`, Grundchance > 0 für jeden Clip, stadtweit eingefroren via pg_cron um 21:00 Berlin (bis 19. Aug: 20:00).
  - 🔒 LEITPLANKE: keine sichtbaren Reaktions-/Follower-Zahlen während des Stadt Corso. ✅ eingehalten (Query selektiert keine Zahlen).
  - 🔒 LEITPLANKE: nur einwilligungs-markierte Momente kommen in Frage. ✅ serverseitig erzwungen.
  - ~~`[ENTSCHEIDUNG OFFEN]` Größe des Stadt Corso/Frequenz~~ → **entschieden:** immer mit so vielen einwilligenden Momenten wie da sind (max. 8), kein Mindest-Schwellwert, kein Fake-Auffüllen.
- **Discovery als langer Scroll-Feed** — **noch nicht gebaut** (`src/routes/index.tsx:99-100` hat weiterhin ein hartes `limit 20` ohne Pagination und ohne Tages-Ordering). Ziel: **Infinite Scroll** (erst ~20, beim Erreichen des Endes nächste 20 nachladen), Reihenfolge **heute zuerst → ältere als Nachschub**, um ein ausgedehntes Scrollverhalten zu etablieren. Details in `docs/STATUS.md`.
  - **Entschieden (15. Juli):** Area = **ganze Stadt Düsseldorf** (Area-Filter vorerst No-Op). Interim ältere Momente als Nachschub, **Endzustand nur heute** (`prompt_date = corso_day(now())`) — bewusst erst später, nicht jetzt eingrenzen.
- ~~**Rücklauf-Screen mit echten Zahlen**~~ → **✅ gebaut & live (15. Juli):** `feedback.tsx` zeigt zwei private Kennzahlen — **Publikum** (aktive Follower) + **Zuschauer** (eindeutige Betrachter des letzten Moments, inkl. anonymer Pool-Zuschauer, PRD-Entscheidung #3 = JA) — je mit neutralem „seit gestern"-Delta. Bewusst **zwei** statt drei Zahlen: „Follower" und „Publikum" wären identisch → keine Redundanz. Ansichten anonym via `post_views`/`record_view`; „seit gestern"-Basis via nächtlichem `snapshot_reach`-Cron; alles über `my_feedback()` (RLS-privat, SECURITY DEFINER). Migration `0010`, deployed. **Dies ist die Datenquelle für die Kill-Metrik „aktiver-Moment-Anteil".**
- **Push-Notifications** (PWA-fähig): 21:00-Push zum Stadt Corso + Push, wenn eine gefolgte Person postet. **Noch nicht begonnen** — im Code existiert nur `public/manifest.json`, kein Service Worker, keine `PushManager`-Anbindung.
  - ⚠️ Dies ist der wichtigste offene Punkt der Phase: **ohne Push gibt es keinen strukturellen Grund zurückzukommen.** Die Kill-Metrik „Daily-Open-Rate ≥ 50 %" wäre ohne Push nicht fair messbar.
  - `[ENTSCHEIDUNG OFFEN]` Die genaue Mechanik des „Privaten Corso" (Push-Fenster 19–22 Uhr, PRD #7) ist ungeklärt und wird hier zum ersten Mal relevant.

**Akzeptanzkriterien:**
- [x] Stadt Corso zeigt zur Ziehungszeit real geposteten Content, nicht Mock. *(15. Juli gebaut; **19. August in der Live-DB bestätigt**: echte Ziehungen am 1., 2. und 13. August, jeweils exakt 18:00 UTC = 20:00 Berlin, aus echten einwilligenden Momenten. Damit ist auch ein echter Cron-Lauf mit echtem Content belegt, nicht nur ein manueller Force-Draw.)*
- [x] Ein Clip ohne Einwilligung erscheint NIE in der Stadt Corso. *(Serverseitiger `city_story_consent = true`-Filter in `draw_city_story`.)*
- [ ] Discovery lädt beim Runterscrollen weitere Momente nach (Infinite Scroll), heute zuerst.
- [x] Rücklauf zeigt für jeden User die korrekte private Zahl. *(15. Juli: `my_feedback()` — Publikum + Zuschauer; RLS-privat, Negativ-Test `scripts/security-test-feedback.mjs` Layer 1 grün. **Die „seit gestern"-Deltas sind seit dem laufenden `snapshot_reach`-Cron real** — zuletzt am 19. August ausgeführt.)*
- [ ] 21:00-Push kommt zuverlässig an.

---

## Phase 2 — Pilot-Härtung

**Ziel:** Genug Robustheit + Sicherheit, um es 20–30 Freunden in die Hand zu geben, ohne dass es peinlich bricht oder jemand zu Schaden kommt.

**Scope:**
- **Onboarding (Screen 1), pragmatisch:** Magic-Link/Telefon-Login + Selbst-Bestätigung „18+". Kurz-Erklärung von Stadt Corso + verfallendem Publikum in unter 30 Sek.
  - **Pilot-Weg gebaut (15. Juli):** E-Mail-freie **Einladungs-Links** (Maxim erzeugt pro Freund, WhatsApp, Klick = eingeloggt). Einmalig, 7 Tage gültig, serverseitig eingelöst. ⚠️ Bewusstes Pilot-Provisorium — der zahlende Fremden-Pilot bekommt echte Self-Service-Registrierung. Details in `docs/STATUS.md`.
  - `[ENTSCHEIDUNG OFFEN]` Volle ID-Verifizierung gehört VOR öffentlichen Launch, NICHT vor Freundes-Pilot. Nicht jetzt bauen.
- **Metrik-/Event-Tracking** (ab Tag 1 instrumentieren, sonst nachträglich nicht rekonstruierbar): Daily-Open-Rate, aktiver-Moment-Anteil, Follow-Events, Auftritte im Stadt Corso, Verbindungen.
- **Report + Block** (minimale Safety): Report = sofort aus allen Pools.
  - **Vorarbeit (16. Juli):** Der **Einstellungen-Screen (Screen 10)** ist minimal gebaut & deployed (`src/routes/settings.tsx`) — mit einer **Blockierte-Personen-Sektion als Platzhalter**, die sauber leer anzeigt und in dieser Phase an eine künftige `blocks`-Tabelle andockt (`useBlockedProfiles`-Stub). Das eigentliche Report/Block-Feature (Blockieren auslösen, Report → aus allen Pools) ist noch NICHT gebaut. Details in `docs/STATUS.md`.

**Akzeptanzkriterien:**
- [ ] Neuer Nutzer kommt ohne Hilfe vom Login bis zum ersten Moment.
- [ ] Die drei Kill-Metriken sind in einem Dashboard ablesbar.
- [ ] Report entfernt einen User sofort aus allen Pools.

---

## Phase 3 — Der Dating-Ausgang

**Ziel:** Der „Ausgang" geht live, sobald der Konsum-Loop Lebenszeichen zeigt. Bewusst nach Phase 1/2, weil der Pilot zuerst testet, ob überhaupt jemand täglich öffnet und postet.

**Scope:**
- **Verbindungs-Screen + verdienter Chat (Screen 8, Flow D):** gegenseitiges Folgen → stiller Hinweis → privater Moment-Austausch → nach 3–4 gegenseitigen Runden Text-Chat frei.
  - 🔒 WICHTIG: Eine angebahnte Verbindung (im Austausch-Status) darf den täglichen Publikum-Verfall ÜBERLEBEN. Die Engine darf nicht den Dating-Ausgang bestrafen, nur weil jemand einen Tag nicht gepostet hat. **Publikum verfällt hart, Verbindungen nicht.**
  - `[ENTSCHEIDUNG OFFEN]` Genaue Trigger-Logik bei täglich verfallenden Follows (PRD offene Entscheidung #8).
- **Richtung reales Treffen** (App verlassen = Erfolg). Kein strukturiertes Treffen-UI (PRD-Entscheidung #4 = NEIN).

**Akzeptanzkriterien:**
- [ ] Gegenseitiges Folgen erzeugt den stillen Hinweis bei beiden.
- [ ] Chat schaltet erst nach der definierten Anzahl Austausch-Runden frei.
- [ ] Eine Verbindung im Austausch überlebt einen Tag ohne Moment.

---

## Bewusst NICHT im MVP (spätere Roadmap)

- Forensisches Watermarking (für Freundes-Pilot irrelevant, vor öffentlichem Launch nötig).
- Monetarisierung / €9-Abo / Consumables.
- Mehrere Städte.
- Kippende Feed-Hierarchie als Code (bei kleinem Pilot manuell vernachlässigbar).
- Settings/Safety über Report+Block hinaus. *(Ein bewusst **minimaler** Einstellungen-Screen — Screen 10 — existiert seit 16. Juli: Push-Präferenz, Blockierte-Platzhalter, Rechts-Links, Anzeigename/Abmelden/manuelle Löschung. Alles darüber hinaus — Granularität, Self-Service-Löschung, globale Sichtbarkeitskontrolle — bleibt bewusst draußen.)*
- Volle ID-Verifizierung.

---

## Offene Punkte, die die Roadmap blockieren können

### Technische Blocker (nicht Entscheidungen — nur Ausführung)

Beide sind am 19. August live verifiziert, kosten je unter 5 Minuten und blockieren den Pilot-Start. Befehle in `docs/STATUS.md`.

| # | Punkt | Wirkung |
|---|---|---|
| T1 | Cloudflare-Secret `SUPABASE_SERVICE_ROLE_KEY` nicht gesetzt | **Einladungs-Links sind funktionsunfähig** → der Haupt-Onboarding-Weg des Freundes-Pilots. Blockt Pilot-Start. |
| T2 | Migration `0014_profile_settings.sql` nicht angewendet | Push-Präferenz + Anzeigename im Einstellungen-Screen werfen eine Fehler-Toast. |

### Offene Entscheidungen

| # | Punkt | Bezug | Status |
|---|---|---|---|
| 1 | Stadt Corso zieht nur „wer heute gepostet hat" + Follower-Gewicht → Cold-Start-Schutz geschwächt ggü. v0.1 | PRD §4.6 | **Bewusst zurückgestellt** (vorerst ignorieren, nicht aufgreifen) |
| 2 | Größe des Stadt Corso/Frequenz bei kleinem Pilot (8 Momente zu dünn?) | PRD offene Entscheidung #6 | ✅ **entschieden (15. Juli):** immer mit so vielen einwilligenden Momenten wie da sind (max. 8), kein Minimum, kein Fake-Auffüllen |
| 3 | Mechanik des „Privaten Corso" (Push-Fenster 19–22 Uhr) | PRD offene Entscheidung #7 | offen — **wird mit dem Push-Feature in Phase 1 fällig** |
| 4 | Verbindungs-Trigger bei täglich verfallenden Follows | PRD offene Entscheidung #8 | offen, blockt erst Phase 3 |
| 5 | Mitigation der Geschlechter-Asymmetrie | PRD offene Entscheidung #10, Risiko §8.2 | offen — blockt keine Bauphase, ist aber das gefährlichste strukturelle Produkt-Risiko vor dem zahlenden Pilot |

> Phase 0 und Phase 1 sind von offenen Entscheidungen frei — außer #3, die mit dem Push-Feature fällig wird.

---

*Ende Roadmap v0.2 — Stand 19. August 2026.*
