#!/usr/bin/env node
// Corso — Migration/SQL per Supabase Management API ausführen (kein service_role,
// kein Dashboard). Token kommt aus der Umgebung (SBP), wird nie geloggt.
//
// Aufruf:
//   node scripts/db-apply.mjs supabase/migrations/0010_post_views_feedback.sql
//
// Das Token wird aus .env gelesen (SBP=...) oder aus der Umgebung, falls dort
// gesetzt. Es wird nie geloggt und gehört nicht in die Kommandozeile.
//
// Optional: PROJECT_REF überschreiben (Default: Pilot-Projekt).

import { readFileSync } from "node:fs";

// Token kommt aus der Umgebung — oder, wenn dort keins steht, aus .env.
// So braucht kein Aufruf das Geheimnis in der Kommandozeile mitzuschleppen
// (und keine Permission-Regel muss es enthalten, was sie bei jedem
// Token-Wechsel brechen würde).
if (!process.env.SBP) {
  try {
    process.loadEnvFile(new URL("../.env", import.meta.url));
  } catch {
    // Keine .env vorhanden — dann muss SBP eben in der Umgebung stehen.
  }
}

const SBP = process.env.SBP;
const REF = process.env.PROJECT_REF ?? "uuhrylkvwosflyypbdbj";
const file = process.argv[2];

if (!SBP) {
  console.error("✗ SBP (Management-Token) nicht gesetzt — weder in der Umgebung noch in .env.");
  console.error("  Neues Token: https://supabase.com/dashboard/account/tokens → als SBP=... in .env eintragen.");
  process.exit(1);
}
if (!file) {
  console.error("✗ Kein SQL-Dateipfad übergeben.");
  process.exit(1);
}

const sql = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SBP}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`✗ HTTP ${res.status}`);
  console.error(text);
  process.exit(1);
}

console.log(`✓ Angewendet: ${file}`);
// Rückgabe kompakt zeigen (i.d.R. [] bei DDL).
try {
  const json = JSON.parse(text);
  console.log(JSON.stringify(json).slice(0, 400));
} catch {
  console.log(text.slice(0, 400));
}
