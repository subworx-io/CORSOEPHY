# Corso — Roadmap

**Version:** 0.1 (Stand 18. Juni 2026)
**Bezug:** Ergänzt das PRD (`docs/PRD.md`). Bei Konflikt gewinnt das PRD.
**Zweck:** Priorisierte Bau-Reihenfolge vom aktuellen Klick-Prototyp zu einem mit Freunden teilbaren MVP.

> **Agent-Hinweis:** Diese Roadmap ist nach Abhängigkeit sortiert, nicht nach Wunsch. Phase 0 blockt fast alles. Nicht an Phase 2/3 anfangen, solange Phase 0/1 nicht durch sind. Bei jeder `[ENTSCHEIDUNG OFFEN]` eskalieren, nicht stillschweigend entscheiden.

---

## Aktueller Stand (Ausgangspunkt)

Klickbarer Frontend-Prototyp (TanStack Start, mobile-first, PWA-fähig). 5 von 10 PRD-Screens existieren. Kein Backend — alle Daten aus Mock-Konstanten, Follow-State lebt nur im React-Context (stirbt beim Reload).

**Steht solide (leitplanken-treu):** Discovery, Stadt-Story (UI), Aufnahme (echte Live-Kamera), Ich-folge mit verfallendem Herz.
**Fehlt:** gesamtes Backend, echter Video-Upload, Onboarding, Rücklauf-Daten, Verbindungs-/Chat-Screen, Metrik-Tracking.

> Tagesaktueller Detail-Stand (WIP, uncommitted Änderungen, nächster konkreter Schritt) → `docs/STATUS.md`.

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

**Ziel:** Aus dem Solo-Klick-Prototyp wird eine zwischen mehreren Geräten geteilte App. Follow-State und Posts überleben Reload und sind serverseitig.

**Scope:**
- Auth (Magic-Link oder Telefonnummer, kein Passwort nötig).
- Persistenz für: User, Posts, Follows, Anstupser.
- Video-Upload + Storage + Auslieferung (der disabled „Verwenden"-Button wird funktional).
- Der **08:00-Reset als echter Server-Job** (Follows verfallen, Discovery leert sich, neuer Prompt).
- Follow-Logik vom React-Context ins Backend migrieren (24h-Verfall, 08:00-Reset, `canRenew`).

**Akzeptanzkriterien:**
- [ ] Zwei verschiedene Handys sehen denselben geteilten Zustand.
- [ ] Ein hochgeladener Clip erscheint auf einem anderen Gerät in der Discovery.
- [ ] Follow überlebt App-Reload.
- [ ] Um 08:00 verfallen Follows serverseitig, ohne dass ein Client offen sein muss.

**Bewusst NICHT in Phase 0:** ID-Verifizierung, Push, Stadt-Story-Algorithmus, Chat.

---

## Phase 1 — Konsum-Loop end-to-end echt

**Ziel:** Die komplette Kern-Kette läuft mit echten Daten zwischen mehreren Geräten. Das ist der eigentliche Test.

**Die Kette:** Post hochladen → erscheint in Discovery → folgbar → kann in Stadt-Story gezogen werden → Rücklauf zeigt echte Zahl → Push bringt zurück.

**Scope:**
- **Stadt-Story-Auswahl als echter Mechanismus** (statt 8 Mock-Clips): serverseitig aus real geposteten, einwilligungs-markierten Clips ziehen. Gedämpfte Variante: Follower erhöhen Chance mit abnehmendem Grenznutzen + **Grundchance > 0 für jeden aktiven Clip.**
  - 🔒 LEITPLANKE: keine sichtbaren Reaktions-/Follower-Zahlen während der Story.
  - 🔒 LEITPLANKE: nur einwilligungs-markierte Clips kommen in Frage.
  - `[ENTSCHEIDUNG OFFEN]` Stadt-Story-Größe/Frequenz bei kleinem Pilot (8 Clips wirken bei 60 Usern evtl. dünn).
- **Rücklauf-Screen mit echten Zahlen** (aktuell Platzhalter): private Follower-Zahl, Veränderung seit gestern, Pool-Zuschauer mitgezählt (PRD-Entscheidung #3 = JA). Dies ist gleichzeitig die Datenquelle für die Kill-Metrik „Post-Anteil".
- **Push-Notifications** (PWA-fähig): 20:00-Stadt-Story-Push + Push, wenn eine gefolgte Person postet.

**Akzeptanzkriterien:**
- [ ] Stadt-Story zeigt um 20:00 real geposteten Content, nicht Mock.
- [ ] Ein Clip ohne Einwilligung erscheint NIE in der Stadt-Story.
- [ ] Rücklauf zeigt für jeden User die korrekte private Zahl.
- [ ] 20:00-Push kommt zuverlässig an.

---

## Phase 2 — Pilot-Härtung

**Ziel:** Genug Robustheit + Sicherheit, um es 20–30 Freunden in die Hand zu geben, ohne dass es peinlich bricht oder jemand zu Schaden kommt.

**Scope:**
- **Onboarding (Screen 1), pragmatisch:** Magic-Link/Telefon-Login + Selbst-Bestätigung „18+". Kurz-Erklärung von Stadt-Story + verfallendem Publikum in unter 30 Sek.
  - `[ENTSCHEIDUNG OFFEN]` Volle ID-Verifizierung gehört VOR öffentlichen Launch, NICHT vor Freundes-Pilot. Nicht jetzt bauen.
- **Metrik-/Event-Tracking** (ab Tag 1 instrumentieren, sonst nachträglich nicht rekonstruierbar): Daily-Open-Rate, aktiver-Post-Anteil, Follow-Events, Stadt-Story-Auftritte, Verbindungen.
- **Report + Block** (minimale Safety): Report = sofort aus allen Pools.

**Akzeptanzkriterien:**
- [ ] Neuer Nutzer kommt ohne Hilfe vom Login bis zum ersten Post.
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
- [ ] Eine Verbindung im Austausch überlebt einen Tag ohne Post.

---

## Bewusst NICHT im MVP (spätere Roadmap)

- Forensisches Watermarking (für Freundes-Pilot irrelevant, vor öffentlichem Launch nötig).
- Monetarisierung / €9-Abo / Consumables.
- Mehrere Städte.
- Kippende Feed-Hierarchie als Code (bei kleinem Pilot manuell vernachlässigbar).
- Settings/Safety über Report+Block hinaus.
- Volle ID-Verifizierung.

---

## Offene Punkte, die die Roadmap blockieren können

| # | Punkt | Bezug | Status |
|---|---|---|---|
| 1 | Stadt-Story zieht nur „wer heute gepostet hat" + Follower-Gewicht → Cold-Start-Schutz geschwächt ggü. v0.1 | PRD §4.6 | **Bewusst zurückgestellt** (vorerst ignorieren, nicht aufgreifen) |
| 2 | Stadt-Story-Größe/Frequenz bei kleinem Pilot (8 Clips zu dünn?) | PRD offene Entscheidung #6 | offen, blockt erst Phase 1 |
| 3 | Verbindungs-Trigger bei täglich verfallenden Follows | PRD offene Entscheidung #8 | offen, blockt erst Phase 3 |

> Phase 0 ist vollständig entblockt. Keine offene Entscheidung steht dem Backend-Fundament im Weg.

---

*Ende Roadmap v0.1 — Stand 18. Juni 2026.*
