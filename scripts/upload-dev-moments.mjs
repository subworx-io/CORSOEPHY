#!/usr/bin/env node
// Corso — Dev-Seed-Fotos in den Storage-Bucket `moments` laden (Pfad-Prefix
// `dev-seed/`). Einmalig (oder nach Bild-Tausch) lokal ausführen:
//
//   node scripts/upload-dev-moments.mjs
//
// Die Bilder liegen versioniert in supabase/seed/dev-moments/. Die Seed-Funktion
// dev_seed_city_story (ab 0025) hängt ihre synthetischen Foto-Momente an genau
// diese Pfade — vorher recycelte sie den Clip eines ECHTEN Users (wirkte wie
// geklaute Momente) bzw. brach ohne lebenden Clip ab.
//
// Braucht den service_role-Key (Storage-RLS erlaubt Uploads sonst nur in den
// eigenen User-Ordner) — Key kommt aus .env, wird nie geloggt. Nur lokal, nie
// im Client/Edge (CLAUDE.md).

import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(new URL("../.env", import.meta.url));

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ VITE_SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt in .env.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const dir = new URL("../supabase/seed/dev-moments/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();

if (files.length === 0) {
  console.error("✗ Keine .jpg-Dateien in supabase/seed/dev-moments/ gefunden.");
  process.exit(1);
}

for (const file of files) {
  const path = `dev-seed/${file}`;
  const body = readFileSync(new URL(file, dir));
  const { error } = await supabase.storage
    .from("moments")
    .upload(path, body, { contentType: "image/jpeg", upsert: true });
  if (error) {
    console.error(`✗ ${path}: ${error.message}`);
    process.exit(1);
  }
  console.log(`✓ ${path} (${(body.length / 1024).toFixed(0)} kB)`);
}

console.log(`Fertig — ${files.length} Dev-Seed-Fotos im Bucket 'moments'.`);
