# Metrik-Tracking ab Tag 1

## Problem
Die Beta wird an drei Kill-Metriken gemessen (Daily-Open-Rate, aktiver-Post-Anteil, verdiente Chats → reale Dates). Ohne ein Event-Log ab dem ersten User sind diese Metriken später nicht sauber rekonstruierbar — verpasste Ereignisse sind für immer weg. Ziel ist nicht Analytics-Deluxe, sondern: nichts vergessen, was hinterher teuer oder unmöglich nachzubauen ist.

## Evidence
- Annahme (betrieblich zwingend) — die Kill-Metriken stehen im Produkt-PRD (`docs/PRD.md`, Screen 7 / §5); die Datenquelle für den aktiven-Post-Anteil ist teils schon angelegt (`my_feedback()` in `0010`). Ohne Roh-Events fehlt die longitudinale Auswertbarkeit.
- Kein externer Analytics-Bedarf belegt → bewusst Supabase-nativ, kein Drittanbieter.

## Users
- **Primär**: Maxim / Betreiber, die nach dem Pilot die drei Kill-Metriken auswerten. Sie brauchen ein lückenloses, vertrauenswürdiges Event-Log.
- **Instrumentiert für**: alle Pilot-Nutzer (Events entstehen bei ihrer normalen Nutzung).
- **Nicht für**: Nutzer selbst — Events sind kein Nutzer-Feature, keine sichtbare Oberfläche.

## Hypothesis
Wir glauben, dass **ein leichtgewichtiges Event-Log ab Tag 1** es erlaubt, **die drei Kill-Metriken lückenlos auszuwerten** für **die Betreiber nach dem Pilot**.
Wir wissen, dass wir richtig liegen, wenn **sich Daily-Open-Rate, aktiver-Post-Anteil und (später) Chat-erreicht → Date je Nutzer und Tag aus den gespeicherten Events berechnen lassen, ohne Lücken**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Event-Abdeckung | 100 % der definierten Event-Typen werden erfasst | Manuelle Gegenprobe: jede Nutzer-Aktion erzeugt genau die erwartete Event-Zeile |
| Auswertbarkeit Kill-Metriken | alle 3 aus Events ableitbar | SQL-Abfragen liefern Daily-Open, aktiver-Post-Anteil, Chat→Date pro Tag/User |
| Manipulationssicherheit | `user_id` nie fälschbar | `log_event()` pinnt `auth.uid()`; keine fremde ID einschleusbar |

## Scope
**MVP** — Ein einfaches, server-seitig geschriebenes Event-Log:

- **Tabelle `events`**: `id uuid`, `user_id uuid (→ profiles)`, `event_type text` (Enum-check), `created_at timestamptz default now()`, `metadata jsonb null`.
- **Schreibweg (Entscheidung: eine RPC)**: alle **user-initiierten** Events über `log_event(event_type, metadata)` — `SECURITY DEFINER`, `user_id = auth.uid()` server-seitig gepinnt, `revoke anon/public`, `grant authenticated`. Der Client übergibt nie eine User-ID.
- **Server-Job-Ausnahme (unvermeidlich)**: Events ohne User-Session — **Follow verfallen** (Verfall-Cron) und **Story-Slot gezogen** (21:00-Job) — werden direkt in ihren bestehenden SQL-Jobs geschrieben, da `auth.uid()` dort NULL ist.
- **Event-Typen (kanonische Liste)**:
  - `app_open` — jede App-Öffnung/Rückkehr in den Vordergrund (Client feuert bei Start + Fokus).
  - `moment_posted` — Moment gepostet.
  - `follow_set` — Follow gesetzt/erneuert.
  - `follow_expired` — Follow verfallen (Server-Job).
  - `story_viewed` — Stadt-Story angesehen (Client, beim Öffnen des Story-Screens).
  - `nudge_sent` — Anstupsen ausgelöst.
  - `chat_reached` — Verbindung erreicht Chat-Status (**Phase 3**; Event-Typ jetzt reserviert, noch nicht gefeuert).
- **Tagesbegriff (Entscheidung: Kalendertag)**: Tagesauswertungen rechnen auf **Kalendertag 00:00 Europe/Berlin** (konsistent mit dem Gemeinschafts-Zähler, bewusst NICHT `corso_day()` 08:00). Gespeichert wird der rohe `created_at` — die Tages-Zuordnung passiert erst in der Auswertung.
- **App-Öffnung (Entscheidung: jeder Start/Fokus)**: jeder Kaltstart und jede Rückkehr-in-den-Vordergrund feuert `app_open` (Öffnungen/Tag als Intensitätssignal).
- **Datensparsamkeit (Entscheidung: nur IDs/Enums)**: `metadata` enthält höchstens Referenz-IDs (z. B. `post_id`, `followee_id`) und Enums — nie Clip-Inhalte, Texte oder personenbezogene Rohdaten.

🔒 **Leitplanken-Erhalt (nicht verhandelbar)**:
- `events` bekommt **RLS an, ohne Client-Lese-Policy** (Muster wie `post_views` in `0010`): kein Nutzer kann fremde — oder eigene — Event-Zeilen direkt auslesen. Auswertung nur via `service_role`/SQL-Konsole.
- Tracking darf **keinen** Weg schaffen, über den Follower-Zahlen oder andere private Daten für andere User sichtbar werden. `metadata` speichert keine aggregierten Privatzahlen.

**Out of scope**
- Dashboards / Visualisierung — nur Rohdaten sammeln (Auswertung manuell per SQL).
- Externe Analytics-Tools.
- Der Chat selbst (Phase 3) — nur der Event-Typ `chat_reached` wird jetzt reserviert.
- Retention/Löschjobs — vorerst alles behalten (siehe Open Questions).
- Trigger-basierte Erfassung der ableitbaren Events — bewusst verworfen zugunsten der einen RPC.

## Delivery Milestones
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | events-Tabelle + log_event() + RLS | Server-seitiges, write-only Event-Log existiert; user_id fälschungssicher | pending | — |
| 2 | Client-Instrumentierung | app_open (Start/Fokus), story_viewed, moment_posted, follow_set, nudge_sent feuern an den richtigen Stellen | pending | — |
| 3 | Server-Job-Events | follow_expired (Verfall-Cron) und Story-Ziehung werden in den bestehenden Jobs protokolliert | pending | — |

## Open Questions
- [ ] Retention: Events unbegrenzt behalten, oder nach Beta-Auswertung anonymisieren/löschen (Datensparsamkeit vs. Longitudinalität)?
- [ ] Wer wertet aus — ausschließlich `service_role`/SQL-Konsole, oder braucht das Dev-Menü (nur `dominik@subworx.io`) später einen Lesepfad?
- [ ] `app_open` bei jedem Fokus kann viele Zeilen erzeugen — genügt das, oder brauchen wir clientseitiges Entprellen (z. B. max. 1 Event / n Minuten), um Rauschen zu begrenzen?
- [ ] Doppeltzählung: zählt das Öffnen des Story-Screens als `app_open` UND `story_viewed`? (Vermutlich ja, bewusst getrennt auswerten.)
- [ ] `follow_set` — soll Erst-Follow und Erneuerung unterschieden werden (Enum in metadata), oder reicht ein Typ?

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Events schaffen versehentlich einen Lesepfad auf private Daten | Niedrig | Hoch | RLS ohne Lese-Policy (write-only); `log_event` gibt nichts zurück; metadata nur IDs/Enums |
| Client-gefeuerte Events (app_open, story_viewed, auch die user-Events) sind fälschbar | Mittel | Niedrig | Bewusst akzeptiert (RPC-Entscheidung); `user_id` bleibt via `auth.uid()` echt; Pilot ist Freundeskreis |
| `app_open` bei jedem Fokus bläht die Tabelle auf | Mittel | Niedrig | Optionales clientseitiges Entprellen (Open Question); Index auf (user_id, created_at) |
| Kill-Metrik später nicht berechenbar, weil ein Signal fehlt | Niedrig | Hoch | Kanonische Event-Liste deckt alle 3 Metriken + Loop-Grundverständnis ab; Review gegen `docs/PRD.md` §5 vor Umsetzung |
| Tagesbegriff (Kalendertag) weicht vom App-Rhythmus (Corso-Tag) ab und verwirrt die Auswertung | Niedrig | Niedrig | Roh-`created_at` gespeichert → Tag jederzeit auf beide Arten rechenbar; Konvention dokumentieren |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
