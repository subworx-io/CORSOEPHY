# Corso — Roadmap

**Version:** 0.3 (Stand 9. September 2026, Status-Abgleich 16. September 2026)
**Bezug:** Ergänzt das PRD (`docs/PRD.md`). Bei Konflikt gewinnt das PRD.
**Zweck:** Priorisierte Bau-Reihenfolge vom aktuellen Klick-Prototyp zu einem mit Freunden teilbaren MVP.

> **Agent-Hinweis:** Diese Roadmap ist nach Abhängigkeit sortiert, nicht nach Wunsch. Phase 0 blockt fast alles. Nicht an Phase 2/3 anfangen, solange Phase 0/1 nicht durch sind. Bei jeder `[ENTSCHEIDUNG OFFEN]` eskalieren, nicht stillschweigend entscheiden.

---

> **Konzept-Änderung 9. September 2026 — der laufende Corso.** Die 21:00-Ziehung und der
> tägliche Prompt sind abgeschafft; der Stadt Corso hat feste Plätze und besetzt laufend
> nach (PRD v0.6 §4.6, Migrationen `0031`/`0032`). Für diese Roadmap heißt das:
> - Der „Konsum-Loop end-to-end" aus Phase 1 gilt weiter, nur ohne Prompt und ohne Ritual-Uhrzeit.
> - **Neu und am Gerät ungetestet:** In-Place-Blättern (PRD v0.7, `/p/$handle` nur noch Deep-Link-Ziel), persönlicher Push „Du stehst im Corso", Medien im Circle-Chat.
> - **Die zentrale offene Wette:** Prompt und 21:00 waren die beiden Dinge, die die Stadt
>   gleichzeitig aktiviert haben. Ob die ständige, leisere Chance auf einen freien Platz genug
>   Zug erzeugt, entscheidet sich erst im Pilot an der Post-Rate (PRD §8, Risiko 5).
> - „Was um 21 Uhr als Event passiert" ist **bewusst geparkt** — nichts dafür bauen.

## Aktueller Stand (16. September 2026)

**Phase 0 ist abgeschlossen. Phase 1 ist feature-vollständig. Phase 2 ist weitgehend gebaut. Phase 3 ist in neuer Form (Circle) gebaut.**

Die App läuft live auf `https://corso-app.pages.dev` (Stand-Commit `1e070b2`, 9. Sep). Der Kern-Loop läuft **ohne Mock**: posten → in Discovery erscheinen → folgen → im laufenden Stadt Corso nachrücken → private Zahl im Rücklauf → Push bringt zurück. Dazu der Circle mit Chat (Achse 2).

- **Phase 1:** Infinite Scroll (19. Aug) und Web-Push (PR #6, 20. Aug) sind gebaut und live.
- **Phase 2:** Onboarding-Flow (`0021`), Metrik-Tracking (`0018_events`), Report + Block (`0017_report_block`) sind gebaut und live. Offen: Kill-Metriken-Dashboard und der Beweis am Gerät.
- **Phase 3:** Der verdiente Chat ist als **Circle** umgesetzt (PRD §4.8, `0024`–`0028`, `0035`) — die ursprünglich hier beschriebene 3–4-Runden-Mechanik ist ersetzt.
- **Was fehlt überall:** der Test am echten Gerät (Gesten, Push, Einladungs-Link mit zwei Geräten). Details in `docs/STATUS.md`.

> ⚠️ **Der Freundes-Pilot hat noch nicht begonnen.** Technisch ist der Weg frei (CF-Secret gesetzt, `0014` angewendet), aber die `invites`-Tabelle ist weiterhin leer (geprüft 16. Sep) — es wurde noch kein Einladungs-Link erzeugt. Es gibt entsprechend **kein Signal zu den Kill-Metriken.**

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
- ✅ **Auswahl für den Stadt Corso als echter Mechanismus** (statt 8 Mock-Clips) — **erledigt 15. Juli** (`0005_city_story_draw.sql`), seit 9. Sep als **laufende Nachbesetzung** (`0031_corso_running.sql`, `refill_corso()` jede Minute, 10 Plätze). Gewichtung unverändert: `w = 1 + ln(1 + aktive_follower)`, Grundchance > 0 für jeden Moment. *(15. Jul–8. Sep: einmal täglich eingefrorene Ziehung, erst 20:00, ab 19. Aug 21:00.)*
  - 🔒 LEITPLANKE: keine sichtbaren Reaktions-/Follower-Zahlen während des Stadt Corso. ✅ eingehalten (Query selektiert keine Zahlen).
  - 🔒 LEITPLANKE: nur einwilligungs-markierte Momente kommen in Frage. ✅ serverseitig erzwungen.
  - ~~`[ENTSCHEIDUNG OFFEN]` Größe des Stadt Corso/Frequenz~~ → **entschieden (15. Jul), neu entschieden 9. Sep:** laufend, 10 Plätze (konfigurierbar), kein Mindest-Schwellwert, kein Fake-Auffüllen.
- ✅ **Discovery als langer Scroll-Feed** — **gebaut 19. Aug** (`components/discovery-feed.tsx`): Infinite Scroll, 20 pro Seite, alle **lebenden** Momente (jünger als 24 h), neueste zuerst, eine Kachel pro Person.
  - **Entschieden (15. Juli):** Area = **ganze Stadt Düsseldorf** (Area-Filter vorerst No-Op). Die damalige Interim-Regel „ältere Momente als Nachschub" ist mit dem 24h-Verfall (19. Aug) hinfällig — kein Auffüllen mit alten Momenten.
- ~~**Rücklauf-Screen mit echten Zahlen**~~ → **✅ gebaut & live (15. Juli):** `feedback.tsx` zeigt zwei private Kennzahlen — **Publikum** (aktive Follower) + **Zuschauer** (eindeutige Betrachter des letzten Moments, inkl. anonymer Pool-Zuschauer, PRD-Entscheidung #3 = JA) — je mit neutralem „seit gestern"-Delta. Bewusst **zwei** statt drei Zahlen: „Follower" und „Publikum" wären identisch → keine Redundanz. Ansichten anonym via `post_views`/`record_view`; „seit gestern"-Basis via nächtlichem `snapshot_reach`-Cron; alles über `my_feedback()` (RLS-privat, SECURITY DEFINER). Migration `0010`, deployed. **Dies ist die Datenquelle für die Kill-Metrik „aktiver-Moment-Anteil".**
- ✅ **Push-Notifications** (PWA) — **gebaut und live seit 20. Aug** (PR #6; `public/sw.js`, `use-push.ts`, Edge Function `send-push`, Einrichtung in `docs/PUSH-SETUP.md`). Anlässe heute: „Du stehst im Corso", neuer Moment einer gefolgten Person, „Dein Publikum wird still", Circle-Nachricht, **Abend-Push 19:00** (seit 16. Sep). *(Der 21:00-Ritual-Push und der 20:45-Vorab-Push sind seit 9. Sep abgeschaltet.)*
  - Zustellung am Gerät belegt (Test-Push, 16. Sep).
  - ✅ **„Privater Corso" (PRD #7) entschieden und gebaut (16. Sep, `0036`):** täglicher Abend-Push um 19:00 Berlin — Absender ist die Stadt, ein leiser Satz aus einer rotierenden Textbank (`city_evening_lines`, keine Wiederholung binnen 20 Tagen), Ziel Corso. Entfällt, wer um 18:00 schon „Dein Publikum wird still" bekam.

**Akzeptanzkriterien:**
- [x] Stadt Corso zeigt real geposteten Content, nicht Mock. *(15. Juli gebaut; **19. August in der Live-DB bestätigt**: echte Ziehungen am 1., 2. und 13. August, jeweils exakt 18:00 UTC = 20:00 Berlin, aus echten einwilligenden Momenten. Damit ist auch ein echter Cron-Lauf mit echtem Content belegt, nicht nur ein manueller Force-Draw.)*
- [x] Ein Clip ohne Einwilligung erscheint NIE in der Stadt Corso. *(Serverseitiger `city_story_consent = true`-Filter — früher in `draw_city_story`, seit 9. Sep in `refill_corso()` und im Blätter-Query von `story.tsx`.)*
- [x] Discovery lädt beim Runterscrollen weitere Momente nach (Infinite Scroll). *(19. Aug; Stillstand-Bug am 9. Sep behoben.)*
- [x] Rücklauf zeigt für jeden User die korrekte private Zahl. *(15. Juli: `my_feedback()` — Publikum + Zuschauer; RLS-privat, Negativ-Test `scripts/security-test-feedback.mjs` Layer 1 grün. **Die „seit gestern"-Deltas sind seit dem laufenden `snapshot_reach`-Cron real** — zuletzt am 19. August ausgeführt.)*
- [ ] Push kommt zuverlässig an. *(Gebaut; früher als „21:00-Push" formuliert — am Gerät noch nicht belegt.)*

---

## Phase 2 — Pilot-Härtung

**Ziel:** Genug Robustheit + Sicherheit, um es 20–30 Freunden in die Hand zu geben, ohne dass es peinlich bricht oder jemand zu Schaden kommt.

**Scope:**
- **Onboarding (Screen 1), pragmatisch:** Magic-Link/Telefon-Login + Selbst-Bestätigung „18+". Kurz-Erklärung von Stadt Corso + verfallendem Publikum in unter 30 Sek.
  - **Pilot-Weg gebaut (15. Juli):** E-Mail-freie **Einladungs-Links** (Maxim erzeugt pro Freund, WhatsApp, Klick = eingeloggt). Einmalig, 7 Tage gültig, serverseitig eingelöst. ⚠️ Bewusstes Pilot-Provisorium — der zahlende Fremden-Pilot bekommt echte Self-Service-Registrierung. Details in `docs/STATUS.md`.
  - `[ENTSCHEIDUNG OFFEN]` Volle ID-Verifizierung gehört VOR öffentlichen Launch, NICHT vor Freundes-Pilot. Nicht jetzt bauen.
- ✅ **Metrik-/Event-Tracking** (ab Tag 1 instrumentieren, sonst nachträglich nicht rekonstruierbar): Daily-Open-Rate, aktiver-Moment-Anteil, Follow-Events, Auftritte im Stadt Corso, Verbindungen. **Gebaut und live** (`0018_events.sql`, PR #5, 20. Aug; `chat_reached` feuert seit dem Circle). Offen: das Dashboard.
- ✅ **Report + Block** (minimale Safety): Report = sofort aus allen Pools. **Gebaut und live** (`0017_report_block.sql`, `components/moment-menu.tsx`, `lib/blocks/use-blocks.ts`; Block sperrt seit dem Circle auch Chat und Circle-Anbahnung). *(Vorarbeit 16. Juli: Einstellungen-Screen mit Blockierte-Platzhalter.)*
- ✅ **Onboarding-Flow für neu Eingeladene** (`onboarding-flow.tsx`, `0021_onboarding_event.sql`, 20. Aug).

**Akzeptanzkriterien:**
- [ ] Neuer Nutzer kommt ohne Hilfe vom Login bis zum ersten Moment.
- [ ] Die drei Kill-Metriken sind in einem Dashboard ablesbar.
- [ ] Report entfernt einen User sofort aus allen Pools.

---

## Phase 3 — Der Dating-Ausgang

**Ziel:** Der „Ausgang" geht live, sobald der Konsum-Loop Lebenszeichen zeigt. Bewusst nach Phase 1/2, weil der Pilot zuerst testet, ob überhaupt jemand täglich öffnet und postet.

> **Umgesetzt am 2. September 2026 als „Circle"** (PRD v0.5 §4.8) — früher als geplant und in
> anderer Form. Die ursprüngliche Mechanik (stiller Hinweis → privater Moment-Austausch →
> nach 3–4 Runden Chat) ist **ersetzt**, die offene Entscheidung #8 damit entschieden.

**Scope (so gebaut):**
- ✅ **Circle + verdienter Chat (Flow D):** 5 Corso-Tage gegenseitigen Folgens (konfigurierbar, 🔒 unsichtbar) → Circle-Eintritt als Überraschung (Splash) → Chat frei. Zweiter Eintrittsweg: persönlicher Einladungs-Link `/c/<token>` (`0026`/`0027`).
  - 🔒 **Publikum verfällt hart, Verbindungen nicht:** die Circle-Verbindung verfällt nie; der verdeckte Zähler pausiert bei Lücken, statt zurückzusetzen.
- ✅ **Chat:** live (`0028`), seit 9. Sep mit Foto/Video/Sprachnachricht und Antworten (`0035`).
- **Richtung reales Treffen** (App verlassen = Erfolg). Kein strukturiertes Treffen-UI (PRD-Entscheidung #4 = NEIN).

**Akzeptanzkriterien:**
- [x] Wiederholtes gegenseitiges Folgen führt zum Circle-Eintritt bei beiden *(gegen die Live-DB end-to-end verifiziert, 2. Sep)*.
- [x] Chat schaltet erst mit dem Circle-Eintritt frei *(RLS auf `circle_messages`)*.
- [x] Eine Circle-Verbindung überlebt Tage ohne Moment *(verfällt nie)*.
- [ ] Alles davon mit zwei echten Geräten geprüft.

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

Beide am 19. August behoben — aktuell gibt es keinen technischen Blocker für den Pilot-Start.

| # | Punkt | Status |
|---|---|---|
| T1 | Cloudflare-Secret `SUPABASE_SERVICE_ROLE_KEY` | ✅ gesetzt (19. Aug), `/invite/__check` grün |
| T2 | Migration `0014_profile_settings.sql` | ✅ angewendet (19. Aug) |
| T3 | service_role-Key rotieren | offen — **vor** dem zahlenden Fremden-Pilot (siehe STATUS, Punkt 3) |

### Offene Entscheidungen

| # | Punkt | Bezug | Status |
|---|---|---|---|
| 1 | Stadt Corso bevorzugt Menschen mit Followern → Cold-Start-Schutz geschwächt ggü. v0.1 | PRD §4.6 | **Bewusst zurückgestellt** (vorerst ignorieren, nicht aufgreifen). Messung 9. Sep: der laufende Corso ist gerechter als die Tagesziehung (Spreizung 6,1× → 2,5×). |
| 2 | Größe des Stadt Corso/Frequenz bei kleinem Pilot | PRD offene Entscheidung #6 | ✅ **neu entschieden (9. Sep):** laufend, 10 Plätze, kein Minimum, kein Fake-Auffüllen |
| 3 | Mechanik des „Privaten Corso" (Push-Fenster 19–22 Uhr) | PRD offene Entscheidung #7 | ✅ **entschieden 16. Sep** — täglicher Abend-Push 19:00 (`0036`) |
| 4 | Verbindungs-Trigger bei täglich verfallenden Follows | PRD offene Entscheidung #8 | ✅ **entschieden (2. Sep):** Circle, 5 gegenseitige Corso-Tage |
| 5 | Mitigation der Geschlechter-Asymmetrie | PRD offene Entscheidung #10, Risiko §8.2 | offen — blockt keine Bauphase, ist aber das gefährlichste strukturelle Produkt-Risiko vor dem zahlenden Pilot |
| 6 | „Was passiert um 21 Uhr als Event?" | PRD offene Entscheidung #11 | **bewusst geparkt** — nichts dafür bauen |

> Keine Bauphase ist durch eine offene Entscheidung blockiert. #3 ist die nächste, die fällig ist.

---

*Ende Roadmap v0.3 — Stand 9. September 2026, Status-Abgleich 16. September 2026.*
