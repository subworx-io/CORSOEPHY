# Release — manueller Knopf in GitHub Actions

Bis hierher lief ein Release von Dominiks Rechner: `bash scripts/deploy.sh` für den
Code, `node scripts/db-apply.mjs <datei>` für jede Migration einzeln, von Hand und
aus dem Kopf. Genau daraus ist am 19. August ein Fehler entstanden: die PRs #3 und #4
wurden gemerged und deployed, die Migrationen `0016`/`0017` aber nie gefahren — der
Gemeinschafts-Zähler und Report/Block waren live tot, ohne dass irgendwo etwas rot war.

Dieser Workflow macht denselben Ablauf wiederholbar und führt Buch.

## Auslösen

GitHub → **Actions** → **Release** → **Run workflow**. Branch wählen (normalerweise
`main`), dann:

| Eingabe | Bedeutung |
|---|---|
| **Migrationen** | `apply` (Default) · `dry-run` (nur zeigen, was liefe) · `skip` |
| **Deploy** | Häkchen an = bauen und nach Cloudflare Pages ausliefern |
| **tag_name** | leer lassen, oder z. B. `v0.3.0` für Tag + GitHub-Release |

Reihenfolge im Lauf: Typecheck → Lint (nur Bericht) → **Migrationen** → **Build +
Deploy** → Bundle-Kontrolle → Rauchtest → optional Tag. Erst Schema, dann Code:
additive Migrationen verträgt alter Code, umgekehrt gilt das nicht.

`main` geht auf **corso-app.pages.dev**. Jeder andere Branch landet als
**Preview-Deploy** unter einer eigenen URL — die steht im Log und in der
Zusammenfassung, die Produktion bleibt unangetastet.

## Wie das Migrations-Ledger arbeitet

`scripts/migrate.mjs` führt in der DB die Tabelle `public.schema_migrations`
(RLS an, keine Policy, keine Grants — nur die Management-API kommt heran).

- **Erstlauf:** Ist das Ledger leer und die DB erkennbar bespielt, werden die in
  `supabase/migrations-baseline.txt` gelisteten Dateien als angewendet **verbucht,
  aber nicht ausgeführt**. Das ist der Stand, der bis zum 19. August von Hand lief.
- **Danach:** Es läuft genau, was im Repo liegt und nicht im Ledger steht — in
  Dateinamen-Reihenfolge, eine Datei pro Anfrage, Buchung in derselben Transaktion.
- **Drift-Schutz:** Wurde eine bereits angewendete Datei nachträglich verändert,
  bricht der Lauf ab (Migrationen sind append-only). Notausgang: `--allow-drift`.
- **Von Hand gefahrene Migration nachtragen** (ohne sie erneut auszuführen):

  ```bash
  node scripts/migrate.mjs --mark-applied supabase/migrations/0018_push_dispatch.sql
  ```

- **Stand ansehen:** `node scripts/migrate.mjs --list`

`scripts/db-apply.mjs` bleibt für den Einzelfall bestehen (eine Datei, sofort, ohne
Ledger). Der Regelweg ist ab jetzt `migrate.mjs`.

---

# TODO für dich — ohne diese Werte läuft der Workflow nicht

## 1. Repository-Secrets

GitHub → Repo → **Settings → Secrets and variables → Actions → Secrets → New repository secret**

| Name | Wert | Woher |
|---|---|---|
| `SUPABASE_MANAGEMENT_TOKEN` | dein `sbp_…`-Token | https://supabase.com/dashboard/account/tokens → *Generate new token*. **Bitte ein frisches erzeugen**, nicht das aus deiner lokalen `.env` — siehe Punkt 5. |
| `CLOUDFLARE_API_TOKEN` | API-Token mit `Cloudflare Pages: Edit` | Cloudflare Dashboard → *My Profile → API Tokens → Create Token → Custom token*. Nur Permission „Account · Cloudflare Pages · Edit", Account auf euren Account einschränken. |
| `CLOUDFLARE_ACCOUNT_ID` | 32-stellige Account-ID | Cloudflare Dashboard → Workers & Pages → rechte Spalte „Account ID". |
| `VITE_SUPABASE_ANON_KEY` | der anon key aus deiner `.env` | Supabase → Project Settings → API. (Öffentlich im Bundle, RLS schützt — trotzdem als Secret, damit er nicht in Logs auftaucht.) |

## 2. Repository-Variables

Gleiche Seite, Reiter **Variables → New repository variable**

| Name | Wert |
|---|---|
| `VITE_SUPABASE_URL` | `https://uuhrylkvwosflyypbdbj.supabase.co` |
| `VITE_APP_URL` | `https://corso-app.pages.dev` |
| `VITE_PILOT_CITY` | `Düsseldorf` |
| `VITE_PILOT_PRICE_EUR` | `9` |
| `SUPABASE_PROJECT_REF` | `uuhrylkvwosflyypbdbj` |
| `CF_PAGES_PROJECT` | `corso-app` |

Die letzten beiden haben Defaults im Code — setzen ist trotzdem sauberer, dann steht
die Projekt-Zuordnung an einer Stelle statt in zwei Skripten.

## 3. Cloudflare-Pages-Secret (nicht GitHub!)

`SUPABASE_SERVICE_ROLE_KEY` wird **zur Laufzeit** vom Worker gelesen (Einlösen der
Einladungs-Links) und darf nie in den Build. Er gehört deshalb nicht zu den
GitHub-Secrets, sondern ins Pages-Projekt:

```bash
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name corso-app
```

Nach heutigem Stand ist er dort bereits gesetzt (die Einladungs-Links funktionieren
live). Bitte einmal bestätigen: Cloudflare → Workers & Pages → corso-app → Settings
→ Variables and Secrets.

## 4. Environment „production" (empfohlen, 1 Minute)

Settings → **Environments → New environment → `production`**. Der Workflow verweist
schon darauf. Dort optional **Required reviewers** eintragen — dann muss ein Release
bestätigt werden, bevor er läuft. Ohne diesen Schritt läuft der Workflow trotzdem,
GitHub legt das Environment beim ersten Lauf selbst an.

## 5. Schlüssel rotieren (überfällig, unabhängig vom Workflow)

`docs/STATUS.md` vermerkt, dass service_role-Key und Management-Token im Chat geteilt
und **noch nicht rotiert** wurden. Beim Anlegen der Secrets ist der richtige Moment:
neues Management-Token erzeugen und das alte löschen, service_role-Key in Supabase
rotieren und in Cloudflare neu setzen.

## 6. Beim Merge des Push-Branches (`feat/web-push-und-rucklauf-bilanz`)

Der Push-Stack liegt bereits auf der Produktions-DB (`push_subscriptions`,
`push_outbox`, `dispatch_push`, Cron `push-dispatch` — am 19. August verifiziert),
seine Migrationsdateien sind aber noch in keinem Ledger. Direkt nach dem Merge, vor
dem ersten Release von `main`:

```bash
node scripts/migrate.mjs --mark-applied \
  supabase/migrations/0016_push_subscriptions.sql \
  supabase/migrations/0017_feedback_two_forces.sql \
  supabase/migrations/0018_push_dispatch.sql \
  supabase/migrations/0019_dev_test_push.sql \
  supabase/migrations/0020_dev_broadcast_push.sql
```

Sonst versucht der erste Release, sie erneut zu fahren, und bricht bei
`create table push_subscriptions` ab (der Lauf stoppt dann sauber, ohne halben Stand —
aber der Release ist rot).

**Zusätzlich:** Dieser Branch belegt `0016` und `0017` doppelt (`0016_push_subscriptions`
neben `0016_city_moment_counts`, `0017_feedback_two_forces` neben `0017_report_block`).
Für das Ledger ist das unkritisch (es bucht Dateinamen), für Menschen nicht. Beim Merge
umbenennen auf `0021…0025` wäre sauber — dann aber **vor** dem `--mark-applied`, sonst
stehen die alten Namen im Ledger.

## 7. Optional, wenn du Ruhe haben willst

- `bun run format` einmal laufen lassen (~80 Prettier-Verstöße auf `main`), danach im
  Workflow `continue-on-error: true` beim Lint-Schritt entfernen. Dann ist auch Lint
  ein echtes Tor statt einer Notiz.
