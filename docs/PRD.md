# Corso — Product Requirements Document

**Version:** 0.1 (Konzept-Stand 17. Juni 2026)
**Status:** Pre-Pilot. Konzept final, Pilot-Spezifikation offen.
**Eigner:** Maxim

> Single Source of Truth für Menschen und AI-Agents, die Korso aufbauen.
> Offene Entscheidungen sind als `[ENTSCHEIDUNG OFFEN]` markiert und dürfen nicht stillschweigend getroffen werden.
> Kritische Leitplanken sind mit 🔒 LEITPLANKE markiert — nicht verhandelbar ohne Freigabe des Eigners.

---

## 1. Die Eine Idee

Korso ist eine **lokale Stadtbeobachtungs-App mit Dating-Ausgang**. Jeden Abend "geht deine Stadt gemeinsam spazieren": rohe, ungeschnittene Video-Momente echter Menschen aus deiner Umgebung. Zu einer festen Uhrzeit kann jeder Mitspieler zufällig ins **stadtweite Rampenlicht** gezogen werden. Wer dort gefällt, gewinnt **Publikum** — aber dieses Publikum **verfällt nach 24 Stunden**, wenn man nicht nachliefert.

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
- Vertikales Live-Video, 5–15 Sek.
- 🔒 **LEITPLANKE: Live-Kamera-Pflicht, kein Galerie-Upload.**
- Mehrere Takes, **kein Schnitt, keine Filter, keine Beauty.**
- Täglicher Prompt zielt auf Emotion, nicht Dokumentation. ≥50 % gesichts-optional.
- **Clip-Lebensdauer: 72 h.**

### 4.2 Stadt-Story (Herzstück, Aufstieg)
- Fixe Uhrzeit (z.B. 20:00). Ganze Stadt sieht dieselbe Mega-Story.
- Auswahl: **gedämpft** (Follower erhöhen Chance mit abnehmendem Grenznutzen + Grundchance > 0).
- 🔒 **Keine sichtbaren Reaktions-/Follower-Zahlen während Stadt-Story.**
- 🔒 **Einwilligung pro Clip, ob Stadt-Story-fähig.**

### 4.3 Verfallendes Publikum (Schwerkraft)
- Follow = 24 h. Danach aktiver Re-Entscheid.
- Ohne neue Clips schmilzt das Publikum.
- Mechanismus: Verlustaversion, nicht Schande.
- 🔒 **Follower-Zahlen sind für andere unsichtbar.** Nur private Zahl für dich selbst. Kritischster Schutzmechanismus.

### 4.4 Zwei Loops
- **Consumption (primär, täglich):** auch für reine Beobachter.
- **Production (sekundär):** verfallendes Publikum + Stadt-Story-Chance.

### 4.5 Kippende Feed-Hierarchie
- Früh: Entdeckungs-Pool dominiert.
- Später: Verfolgungs-Feed übernimmt automatisch.

### 4.6 Verbindungs-Mechanik (verdienter Chat)
1. Gegenseitiges 24h-Folgen → stiller Hinweis.
2. Privater Moment-Austausch.
3. Nach 3–4 Runden gegenseitigem Austausch → Text-Chat frei.
- Ziel: reales Treffen (App verlassen = Erfolg).

### 4.7 Tagesablauf

| Zeit | Ereignis | Anker |
|---|---|---|
| Tagsüber | Prompt sichtbar | Wordle-Effekt |
| 19–22 Uhr (zufällig) | Privater Korso (Push) | Variable Reward |
| 20:00 fix | Stadt-Story | Ritual + Termin |
| Laufend | 24h folgen/nicht (2 Sek, keine Likes) | Anti-Katalog |
| Mitternacht | Alles verfällt | Knappheit |
| Morgens | Private Follower-Zahl | Verlust/Gewinn spürbar |

---

## 5. Screens & Flows

### Screen-Inventar
1. Onboarding / ID-Verifizierung
2. Heute-Screen (Prompt + Countdown)
3. Korso-Screen (Verfolgung + Pool von 8)
4. Stadt-Story-Screen (20:00, vollbild)
5. Aufnahme-Screen (Live-Kamera + Einwilligungs-Toggle)
6. Rücklauf-Screen (morgens, private Zahl)
7. Verbindungs-Screen (Gegenseitigkeiten, verdienter Chat)
8. Profil/Self (minimal, eigene Zahl, eigene Clips)
9. Settings / Safety

### Kern-Flows
- **A — Erster Abend:** Onboarding → ID → Heute → Push 20:00 → Stadt-Story → Korso → folgen → optional Clip.
- **B — Stammnutzer:** Prompt → Push → Verfolgung → Stadt-Story → Pool → Rücklauf.
- **C — Aufstieg:** Clip mit Einwilligung → Stadt-Story → Publikum wächst → Rücklauf zeigt Sprung.
- **D — Dating-Ausgang:** Gegenseitig folgen → Moment-Austausch → Chat → reales Treffen.

Prinzip: **Promenade zuerst, Kabine danach.**

---

## 6. Competition

| App | Abgrenzung |
|---|---|
| BeReal | Korso = Fremde + Dating-Ausgang, Ritual als Herz statt Notification |
| Snapchat | Korso = Entdeckung Unbekannter |
| Tinder/Hinge | Kein Profil, Chat als Belohnung |
| Raya/League | Korso = Event + tägliche Bewegung |
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
2. **Geschlechter-Asymmetrie:** Männer jagen, Frauen überrannt.
3. **Frühphasen-Konsum-Tiefe:** LinkedIn-Hook schwach, wenn man halten muss.

---

## 9. MVP / Pilot

- **Stadt:** Düsseldorf. **Dauer:** 4–6 Wochen. **Größe:** 60–100 zahlende Mitglieder.
- **Tooling:** Telegram-Bot, keine native App.
- **Preis:** Ab Tag 1 zahlend (€9).
- **Kill-Metriken:**
  - Woche-4 Daily-Open-Rate < 50 % → Konsum tot.
  - Woche-4 aktiver-Clip-Anteil < 40 % → Supply tot.
  - < 5 verdiente Chats → reale Dates → Dating-Ausgang tot.
- **Out of Scope:** Native App, Watermarking, autom. Stadt-Story, Consumables, mehrere Städte.

---

## 10. Offene Entscheidungen (Status)

1. Rampenlicht-Auswahl → **GEDÄMPFT** ✓
2. Austausch-Runden bis Chat → **3–4** ✓
3. Rücklauf zählt Pool-Zuschauer → **JA** ✓
4. Strukturierter Treffen-Vorschlag UI → **NEIN** ✓
5. Tech-Stack native App → offen
6. Stadt-Story-Frequenz/-Größe Tuning → offen

---

*Ende PRD v0.1.*