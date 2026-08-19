# Push in Betrieb nehmen

Der Code steht vollständig (Migrationen 0016/0018/0019, `public/sw.js`,
`src/hooks/use-push.ts`, `supabase/functions/send-push/`). Was fehlt, sind
Zugangsdaten und ein Deploy. Fünf Schritte, danach klingelt es.

Bezug: `docs/ROADMAP.md` Phase 1, letzter offener Punkt.

---

## 1. VAPID-Schlüsselpaar erzeugen (einmalig)

```bash
node scripts/make-vapid-keys.mjs
```

Das Paar identifiziert Corso gegenüber Apple, Google und Mozilla.
**Nur einmal erzeugen.** Ein Wechsel macht jedes bestehende Abo ungültig —
jeder Nutzer müsste Push neu erlauben.

- Öffentlicher Schlüssel → `.env` als `VITE_VAPID_PUBLIC_KEY` **und** als
  Umgebungsvariable im Cloudflare-Pages-Projekt (er landet im Frontend-Bundle,
  das ist so vorgesehen).
- Privater Schlüssel → **ausschließlich** Supabase, nie mit `VITE_`-Präfix,
  nie committen.

## 2. Migrationen anwenden

```bash
node scripts/db-apply.mjs   # 0016, 0018, 0019
```

- `0016` — Abo-Tabelle `push_subscriptions` + RLS
- `0018` — Warteschlange `push_outbox`, die drei Anlässe, Cron-Jobs
- `0019` — „Test-Push an mich" im Dev-Menü

## 3. Edge Function deployen

```bash
supabase functions deploy send-push --project-ref uuhrylkvwosflyypbdbj
```

Danach im Dashboard → Edge Functions → Secrets setzen:

| Secret | Wert |
|---|---|
| `VAPID_PUBLIC_KEY` | aus Schritt 1 |
| `VAPID_PRIVATE_KEY` | aus Schritt 1 |
| `VAPID_SUBJECT` | `mailto:…` — eine erreichbare Adresse |
| `PUSH_DISPATCH_SECRET` | langes Zufallsgeheimnis, frei gewählt |

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase selbst bereit —
deshalb bleibt der service_role-Key aus Cloudflare heraus (CLAUDE.md).

## 4. Vault-Secrets setzen (damit die DB die Function erreicht)

Im SQL-Editor, einmalig:

```sql
select vault.create_secret(
  'https://uuhrylkvwosflyypbdbj.supabase.co/functions/v1/send-push',
  'push_dispatch_url');
select vault.create_secret('<dasselbe PUSH_DISPATCH_SECRET>',
  'push_dispatch_secret');
```

Fehlt eines von beidem, läuft der minütliche Tick still ins Leere — absichtlich:
ein halb konfigurierter Push soll nichts kaputt machen.

## 5. Deployen und auf dem iPhone prüfen

```bash
bash scripts/deploy.sh
```

Dann auf dem iPhone:

1. Corso **vom Home-Bildschirm** öffnen (nicht aus dem Safari-Tab —
   iOS erlaubt Web Push ausschließlich aus der installierten PWA).
2. Einstellungen → Push-Benachrichtigungen einschalten, Systemabfrage erlauben.
3. Dev-Menü → **Test-Push an mich**. Kommt binnen einer Minute an.

---

## Wenn nichts ankommt

| Symptom | Ursache |
|---|---|
| Kein Switch, nur ein Install-Hinweis | Safari-Tab statt installierter PWA. Auf iOS gibt es dort kein Web Push. |
| Switch springt zurück | Systemabfrage abgelehnt. Nur noch über iOS-Einstellungen → Corso umkehrbar. |
| „Auf diesem Gerät gerade nicht aktiv" | Abo weg, Präferenz noch an — passiert, wenn die PWA neu installiert wurde. Einmal aus- und wieder einschalten. |
| Test-Push meldet „Kein Gerät angemeldet" | `push_subscriptions` ist für dich leer — Schritt 5.2 hat nicht durchgeschrieben. |
| Nichts kommt, keine Fehlermeldung | `select * from push_outbox order by created_at desc limit 5;` — steht dort `sent_at`? Wenn nein, hakt der Tick (Schritt 4). Wenn ja, aber nichts ankommt: Function-Logs prüfen, `last_error` lesen. |

## Was bewusst nicht gebaut ist

- **Anstupser-Rücklauf als Push** (PRD §121) — als Anlass zurückgestellt.
- **Kein Push-Text enthält je eine Zahl.** Publikumsgröße und Zuschauer sind
  privat; ein Sperrbildschirm ist kein privater Ort.
- **Kein Nachliefern verpasster Rituale.** Ein 21:00-Push, der um 7 Uhr morgens
  ankommt, ist Müll — die Warteschlange verwirft Zeilen nach drei Stunden.
