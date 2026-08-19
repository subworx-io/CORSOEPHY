#!/usr/bin/env node
// Corso — Release-Migrator: wendet ausstehende SQL-Migrationen in Reihenfolge an.
//
// Läuft über die Supabase Management API (kein service_role, kein Dashboard) und
// führt Buch darüber, was schon auf der DB ist — in der Tabelle
// `public.schema_migrations`. Ohne dieses Buch wäre ein wiederholbarer Release
// unmöglich: `create table blocks (...)` scheitert beim zweiten Lauf.
//
// Aufrufe:
//   node scripts/migrate.mjs                 # ausstehende Migrationen anwenden
//   node scripts/migrate.mjs --dry-run       # nur zeigen, was liefe
//   node scripts/migrate.mjs --list          # Ledger + Dateien nebeneinander
//   node scripts/migrate.mjs --mark-applied supabase/migrations/0018_x.sql
//                                            # als angewendet verbuchen, OHNE auszuführen
//                                            # (für Migrationen, die von Hand liefen)
//   node scripts/migrate.mjs --allow-drift   # geänderte, bereits angewendete Datei dulden
//
// Token: SUPABASE_MANAGEMENT_TOKEN oder SBP (Umgebung oder .env). Wird nie geloggt.
// Projekt: SUPABASE_PROJECT_REF oder PROJECT_REF (Default: Pilot-Projekt).

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const BASELINE_FILE = join(ROOT, "supabase", "migrations-baseline.txt");

// Token aus der Umgebung — oder, wenn dort keins steht, aus .env. So braucht kein
// Aufruf das Geheimnis in der Kommandozeile mitzuschleppen.
if (!process.env.SUPABASE_MANAGEMENT_TOKEN && !process.env.SBP && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(join(ROOT, ".env"));
  } catch {
    // Keine .env (z. B. in CI) — dann muss das Token in der Umgebung stehen.
  }
}

const TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN ?? process.env.SBP;
const REF = process.env.SUPABASE_PROJECT_REF ?? process.env.PROJECT_REF ?? "uuhrylkvwosflyypbdbj";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const listOnly = args.includes("--list");
const allowDrift = args.includes("--allow-drift");
const markApplied = args
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.replace(/^.*supabase\/migrations\//, ""));
const markMode = args.includes("--mark-applied");

if (!TOKEN) {
  fail("SUPABASE_MANAGEMENT_TOKEN / SBP nicht gesetzt — weder in der Umgebung noch in .env.");
}
if (markMode && markApplied.length === 0) {
  fail("--mark-applied braucht mindestens einen Dateinamen.");
}

// ── kleine Helfer ──────────────────────────────────────────────────────────
const lines = [];
function say(msg) {
  console.log(msg);
  lines.push(msg);
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  writeSummary(`### ✗ Migrationen fehlgeschlagen\n\n${msg}\n`);
  process.exit(1);
}
/** Schreibt die Zusammenfassung in die GitHub-Actions-Übersicht, falls vorhanden. */
function writeSummary(md) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (target) appendFileSync(target, `${md}\n`);
}
/** Postgres-String-Literal. */
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
    err.http = res.status;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

// ── Ablauf ─────────────────────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (files.length === 0) fail(`Keine Migrationen in ${MIGRATIONS_DIR}.`);

const checksums = new Map(files.map((f) => [f, sha256(readFileSync(join(MIGRATIONS_DIR, f), "utf8"))]));

say(`▸ Projekt ${REF} · ${files.length} Migrationsdateien im Repo`);

// 1) Ledger sicherstellen. RLS an, keine Policy, keine Grants → über PostgREST
//    für anon/authenticated unsichtbar; nur die Management-API (postgres) kommt heran.
await query(`
  create table if not exists public.schema_migrations (
    filename   text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now(),
    applied_by text not null default 'release'
  );
  alter table public.schema_migrations enable row level security;
  revoke all on table public.schema_migrations from anon, authenticated;
`).catch((e) => fail(`Ledger-Tabelle konnte nicht angelegt werden.\n${e.message}`));

// 2) Ledger lesen.
let ledger = new Map(
  (await query("select filename, checksum from public.schema_migrations")).map((r) => [r.filename, r.checksum]),
);

// 3) Erstlauf: Was schon von Hand auf der DB liegt, aus der Baseline verbuchen —
//    aber nur, wenn die DB auch wirklich bespielt ist. Auf einer leeren DB wird
//    stattdessen ab 0001 alles gefahren.
if (ledger.size === 0) {
  const [{ provisioned }] = await query("select (to_regclass('public.posts') is not null) as provisioned");
  if (!provisioned) {
    say("▸ Leere Datenbank erkannt (keine posts-Tabelle) — es wird ab 0001 alles angewendet.");
  } else if (!existsSync(BASELINE_FILE)) {
    fail(`Bespielte DB, aber kein Ledger und keine Baseline (${BASELINE_FILE}). Abbruch statt Blindflug.`);
  } else {
    const baseline = readFileSync(BASELINE_FILE, "utf8")
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean);
    const missing = baseline.filter((f) => !checksums.has(f));
    if (missing.length) fail(`Baseline nennt Dateien, die es nicht gibt: ${missing.join(", ")}`);
    const values = baseline.map((f) => `(${lit(f)}, ${lit(checksums.get(f))}, 'baseline')`).join(",\n    ");
    await query(`
      insert into public.schema_migrations (filename, checksum, applied_by)
      values ${values}
      on conflict (filename) do nothing;
    `);
    say(`▸ Erstlauf: ${baseline.length} Migrationen aus der Baseline als angewendet verbucht (nicht ausgeführt).`);
    ledger = new Map(
      (await query("select filename, checksum from public.schema_migrations")).map((r) => [r.filename, r.checksum]),
    );
  }
}

// 4) Drift: angewendete Datei nachträglich verändert? Migrationen sind append-only.
const drifted = files.filter((f) => ledger.has(f) && ledger.get(f) !== checksums.get(f));
if (drifted.length) {
  const msg = `Bereits angewendete Migrationen wurden nachträglich verändert:\n  ${drifted.join("\n  ")}\nMigrationen sind append-only — neue Datei mit der nächsten Nummer anlegen.`;
  if (allowDrift) say(`⚠ ${msg}\n(wegen --allow-drift nur eine Warnung)`);
  else fail(msg);
}

// 5) --mark-applied: verbuchen ohne auszuführen.
if (markMode) {
  const unknown = markApplied.filter((f) => !checksums.has(f));
  if (unknown.length) fail(`Unbekannte Migrationsdatei(en): ${unknown.join(", ")}`);
  const values = markApplied.map((f) => `(${lit(f)}, ${lit(checksums.get(f))}, 'manual')`).join(",\n    ");
  await query(`
    insert into public.schema_migrations (filename, checksum, applied_by)
    values ${values}
    on conflict (filename) do update set checksum = excluded.checksum;
  `);
  say(`✓ Als angewendet verbucht (nicht ausgeführt): ${markApplied.join(", ")}`);
  writeSummary(`### Migrationen\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`);
  process.exit(0);
}

const pending = files.filter((f) => !ledger.has(f));

if (listOnly) {
  say("");
  for (const f of files) say(`  ${ledger.has(f) ? "✓ angewendet" : "· ausstehend "}  ${f}`);
  writeSummary(`### Migrationen (Stand)\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  process.exit(0);
}

if (pending.length === 0) {
  say("✓ Nichts anzuwenden — die DB ist auf dem Stand des Repos.");
  writeSummary(`### Migrationen\n\n✓ Nichts anzuwenden (${files.length} Dateien, alle verbucht).\n`);
  process.exit(0);
}

say(`▸ Ausstehend (${pending.length}):`);
for (const f of pending) say(`    ${f}`);

if (dryRun) {
  say("▸ --dry-run: nichts ausgeführt.");
  writeSummary(`### Migrationen (Probelauf)\n\nWürde anwenden:\n${pending.map((f) => `- \`${f}\``).join("\n")}\n`);
  process.exit(0);
}

// 6) Anwenden — eine Datei pro Request, in Dateinamen-Reihenfolge.
//    Der Ledger-Eintrag hängt an derselben Anfrage: Der Management-Endpunkt fährt
//    die Anweisungsfolge in einer impliziten Transaktion, dadurch gibt es kein
//    "SQL lief, aber die Buchung fehlt".
for (const f of pending) {
  const raw = readFileSync(join(MIGRATIONS_DIR, f), "utf8").trimEnd();
  const body = raw.endsWith(";") ? raw : `${raw};`;
  const record = `insert into public.schema_migrations (filename, checksum, applied_by) values (${lit(f)}, ${lit(checksums.get(f))}, ${lit(process.env.GITHUB_ACTOR ? `gh:${process.env.GITHUB_ACTOR}` : "release")});`;
  try {
    await query(`${body}\n${record}`);
    say(`  ✓ ${f}`);
  } catch (e) {
    fail(
      `${f} fehlgeschlagen — abgebrochen, die folgenden Migrationen wurden NICHT angewendet.\n${e.message}\n\n` +
        `Wenn diese Migration in Wahrheit längst von Hand auf der DB liegt:\n` +
        `  node scripts/migrate.mjs --mark-applied supabase/migrations/${f}`,
    );
  }
}

say(`✓ ${pending.length} Migration(en) angewendet.`);
writeSummary(`### Migrationen\n\nAngewendet:\n${pending.map((f) => `- \`${f}\``).join("\n")}\n`);
