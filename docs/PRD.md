# Corso — Product Requirements Document

**Version:** 0.2 (Stand 18. Juni 2026)
**Status:** Pre-Pilot. Konzept final, Pilot-Spezifikation offen.
**Eigner:** Maxim

> Single Source of Truth für Menschen und AI-Agents, die Corso aufbauen.
> Offene Entscheidungen sind als `[ENTSCHEIDUNG OFFEN]` markiert und dürfen nicht stillschweigend getroffen werden.
> Kritische Leitplanken sind mit 🔒 LEITPLANKE markiert — nicht verhandelbar ohne Freigabe des Eigners.

---

## 1. Die Eine Idee

Corso ist eine **lokale Stadtbeobachtungs-App mit Dating-Ausgang**. Jeden Tag gibt es einen gemeinsamen Prompt — jeder postet seinen Moment, die Stadt scrollt, folgt, vergisst oder erinnert sich. Um 20:00 Uhr sieht die ganze Stadt dieselben acht ausgewählten Momente. Wer dort gefällt, gewinnt **Publikum** — aber dieses Publikum **verfällt täglich um 08:00 Uhr**, wenn man nicht nachliefert.

### Zentrale emotionale Mechanik
- **Stadt-Story = Aufstieg.** Random, plötzlich, vor der ganzen Stadt.
- **Verfallendes Publikum = Schwerkraft.** Wer nicht nachliefert, sinkt.

Zusammen: ständige Bewegung statt statischer Hierarchie.

---

## 2. Value Proposition

**Konsument (primär):** "Jeden Abend sehe ich, wie meine Stadt wirklich lebt."
**Produzent (sekundär):** "Heute Abend könnte die ganze Stadt mich sehen."

Dating ist der **Ausgang**, nicht der Eingang. Diese Reihenfolge prägt jede Entscheidung.

### Drei Differenzierer
1. Verfallendes Publikum als Produktions-Engine.
2. Verdienter Chat (Belohnung statt Startpunkt).
3. Stadt-Story als kollektives Ritual.

---

## 3. Zielgruppe & Markt

- **ICP:** 20–32, dicht besiedelte Stadt, Dating-App-müde.
- **Pilot-Stadt:** Düsseldorf (Gründer vor Ort, hohe Bevölkerungsdichte, starke Ausgehkultur).
- **Kritische Masse:** `[ANNAHME]` ~800–1.000 Aktive/Stadt.

---

## 4. Kern-Mechaniken

### 4.1 Der "Moment"
- Foto oder vertikales Video.
- 🔒 **LEITPLANKE: Live-Kamera-Pflicht, kein Galerie-Upload.**
- Mehrere Takes, **kein Schnitt, keine Filter, keine Beauty.**
- Täglicher Prompt zielt auf Emotion, nicht Dokumentation. ≥50 % gesichts-optional.
- **Clip-Lebensdauer: bis zum nächsten 08:00-Uhr-Reset** (max. ~24 h).

### 4.2 Der tägliche Prompt
- Jeden Tag um **08:00 Uhr** erscheint ein neuer Prompt.
- Gleichzeitig mit dem Reset aller Follows (siehe 4.3).
- Jeder kann darauf mit einem Foto oder Video antworten.
- Posts sind ab dem Moment des Uploads in der Discovery sichtbar.

### 4.3 Das Follow-System (verfallendes Publikum)

**Grundprinzip:** Ein Follow ist kein permanenter Zustand, sondern ein täglicher aktiver Entscheid.

**Täglicher Reset-Moment: 08:00 Uhr.**

Konkretes Beispiel:
- **Montag 09:00** — Du folgst Person A.
- **Dienstag nach 08:00** — Person A erscheint weiterhin in deinem "Ich folge"-Feed und du siehst ihren neuen Post des Tages (sofern sie gepostet hat).
- **Dienstag irgendwann** — Du entscheidest: refolgen oder nicht?
- **Mittwoch 08:00** — Kein Refolge → Person A verschwindet. Refolge → nochmal ein Tag.

**Regel:** Ein Follow gibt immer mindestens einen vollen Folgetag Zeit zur Entscheidung. Refolgen ist erst ab dem nächsten 08:00-Reset möglich (kein Doppel-Follow am selben Tag).

🔒 **LEITPLANKE: Follower-Zahlen sind für andere unsichtbar.** Nur private Zahl für dich selbst.

### 4.4 Die zwei Feeds

| Feed | Inhalt | Logik |
|---|---|---|
| **Discovery** | Fremde, randomized | Entdeckung neuer Menschen |
| **Ich folge** | Leute denen du aktiv folgst | Verfolgung bekannter Gesichter |

**Discovery-Verhalten:**
- Ab 08:00 Uhr leer (alle Posts des Vortages weg).
- Füllt sich organisch im Laufe des Tages, wenn Leute posten.
- Posts erscheinen in der Discovery ab dem Moment des Uploads.
- Zeigt nur Leute, denen du noch nicht folgst.

**"Ich folge"-Verhalten:**
- Nach 08:00 Uhr zunächst leer, bis jemand dem du folgst einen neuen Post hochlädt.
- Zeigt auch Leute, denen du folgst, die heute noch nicht gepostet haben (mit Anstupsen-Option).

### 4.5 Anstupsen

Wenn jemand in deinem "Ich folge"-Feed heute noch nichts gepostet hat, kannst du ihn anstupsen.

- **Limit:** 1 Anstupser pro Person pro Tag.
- **Sichtbarkeit:** Person A sieht, wer sie angestupst hat.
- **Feedback-Loop:** Postet Person A nach dem Anstupsen, bekommt der Anstupsende eine Benachrichtigung.
- **Verfügbar:** Nur unter "Ich folge", nicht in der Discovery.

### 4.6 Stadt-Story (Herzstück, Aufstieg)

- Fixe Uhrzeit: **20:00 Uhr**. Ganze Stadt sieht dieselben **8 Momente**.
- Auswahl: **gedämpft** (Follower erhöhen Chance mit abnehmendem Grenznutzen + Grundchance > 0).
- Nur wer **heute gepostet hat** kann in die Stadt-Story kommen.
- Wer noch nicht in der Stadt-Story war, kann danach wie gewohnt gefolgt werden.
- Wer bereits gefolgt wird und in der Stadt-Story erscheint: kein Problem — der User sieht ob er schon renewed hat oder nicht.
- 🔒 **Keine sichtbaren Reaktions-/Follower-Zahlen während Stadt-Story.**
- 🔒 **Einwilligung pro Post, ob Stadt-Story-fähig.**

### 4.7 Kippende Feed-Hierarchie
- Früh: Entdeckungs-Pool dominiert.
- Später: Verfolgungs-Feed übernimmt automatisch.

### 4.8 Verbindungs-Mechanik (verdienter Chat)
`[ENTSCHEIDUNG OFFEN]` — Genaue Trigger-Logik noch nicht definiert. Grundprinzip:
1. Gegenseitiges Folgen → stiller Hinweis.
2. Privater Moment-Austausch.
3. Nach mehreren Runden gegenseitigem Austausch → Text-Chat frei.
- Ziel: reales Treffen (App verlassen = Erfolg).

### 4.9 Tagesablauf

| Zeit | Ereignis | Mechanik |
|---|---|---|
| **08:00** | Reset-Moment | Neuer Prompt + alle Follows verfallen + Discovery leer |
| **08:00–19:59** | Content-Phase | Posten, Discovery füllt sich, Anstupsen möglich |
| **19–22 Uhr (variabel)** | Privater Korso (Push) | `[ENTSCHEIDUNG OFFEN]` |
| **20:00** | Stadt-Story | 8 Momente, ganze Stadt, Ritual |
| **20:00–07:59** | Abend/Nacht | Refolge-Entscheidungen, Discovery & Ich folge aktiv |
| **08:00 (Folgetag)** | Reset | Zyklus beginnt neu |

---

## 5. Screens & Flows

### Screen-Inventar
1. Onboarding / ID-Verifizierung
2. Heute-Screen (Prompt + Countdown bis 20:00)
3. Discovery-Screen (randomized Feed, nur Fremde)
4. Ich-folge-Screen (gefolgte Leute + Anstupsen)
5. Stadt-Story-Screen (20:00, Vollbild, 8 Momente)
6. Aufnahme-Screen (Live-Kamera + Einwilligungs-Toggle für Stadt-Story)
7. Rücklauf-Screen (morgens, private Follower-Zahl)
8. Verbindungs-Screen (Gegenseitigkeiten, verdienter Chat)
9. Profil/Self (minimal, eigene Zahl, eigene Posts)
10. Settings / Safety

### Kern-Flows
- **A — Erster Abend:** Onboarding → ID → Heute → Push 20:00 → Stadt-Story → Discovery → folgen → optional Post.
- **B — Stammnutzer:** Prompt → Posten → "Ich folge" checken → Anstupsen → Stadt-Story → Rücklauf.
- **C — Aufstieg:** Post mit Einwilligung → Stadt-Story → Publikum wächst → Rücklauf zeigt Sprung.
- **D — Dating-Ausgang:** Gegenseitig folgen → Moment-Austausch → Chat → reales Treffen.

Prinzip: **Promenade zuerst, Kabine danach.**

---

## 6. Competition

| App | Abgrenzung |
|---|---|
| BeReal | Corso = Fremde + Dating-Ausgang, Ritual als Herz statt Notification |
| Snapchat | Corso = Entdeckung Unbekannter |
| Tinder/Hinge | Kein Profil, Chat als Belohnung |
| Raya/League | Corso = Event + tägliche Bewegung |
| TikTok | Lokal, bounded, verfallend statt akkumulierend |

**Moat:** Execution-Speed zu Stadt-Dichte. Strukturell: Match Group kann nicht ohne ihr eigenes Modell zu kannibalisieren nachbauen.

---

## 7. Monetization

- **Abo Membership (~€9–12/Monat):** Ticket zur Stadt.
- **Consumables:** nur Konsum/Reise (Städte-Zugang, Archiv).
- 🔒 **Verboten:** Publikum-Verfall verlängern, "wer folgt"-Einblick, Rampenlicht-Chance kaufen. Würde Design brechen.

---

## 8. Risiken

1. **Existenz:** Ist Alltagsmoment Fremder interessant genug für tägliche Rückkehr?
2. **Geschlechter-Asymmetrie:** Männer jagen, Frauen überrannt. `[MITIGATION OFFEN]`
3. **Frühphasen-Konsum-Tiefe:** Feed kurz nach 08:00 leer — wie überbrückt man den leeren Morgen?
4. **Kritische Masse Stadt-Story:** Funktioniert erst ab ausreichender Nutzerdichte — Pilot mit 60–100 Usern könnte dünn wirken.

---

## 9. MVP / Pilot

- **Stadt:** Düsseldorf. **Dauer:** 4–6 Wochen. **Größe:** 60–100 zahlende Mitglieder.
- **Tooling:** Telegram-Bot, keine native App.
- **Preis:** Ab Tag 1 zahlend (€9).
- **Kill-Metriken:**
  - Woche-4 Daily-Open-Rate < 50 % → Konsum tot.
  - Woche-4 aktiver-Post-Anteil < 40 % → Supply tot.
  - < 5 verdiente Chats → reale Dates → Dating-Ausgang tot.
- **Out of Scope:** Native App, Watermarking, autom. Stadt-Story, Consumables, mehrere Städte.

> ⚠️ **Offenes Spannungsfeld:** Die 🔒 Leitplanke "Live-Kamera-Pflicht" ist technisch im Telegram-Bot nicht nativ umsetzbar. Lösung für Pilot noch zu definieren.

---

## 10. Offene Entscheidungen (Status)

| # | Entscheidung | Status |
|---|---|---|
| 1 | Rampenlicht-Auswahl | **GEDÄMPFT** ✓ |
| 2 | Austausch-Runden bis Chat | **3–4** ✓ (Trigger-Logik offen) |
| 3 | Rücklauf zählt Pool-Zuschauer | **JA** ✓ |
| 4 | Strukturierter Treffen-Vorschlag UI | **NEIN** ✓ |
| 5 | Tech-Stack native App | offen |
| 6 | Stadt-Story-Frequenz/-Größe Tuning | offen |
| 7 | Privater Korso (Push 19–22 Uhr) — genaue Mechanik | offen |
| 8 | Verbindungs-Trigger bei täglich-verfallenden Follows | offen |
| 9 | Live-Kamera-Lösung für Telegram-Pilot | offen |
| 10 | Mitigation Geschlechter-Asymmetrie | offen |

---

*Ende PRD v0.2 — Stand 18. Juni 2026.*