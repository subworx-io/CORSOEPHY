#!/usr/bin/env node
// Corso — Einladungs-Links erzeugen (Freundes-Pilot, E-Mail-frei)
//
// ⚠️ PILOT-PROVISORIUM. Lokales Admin-Werkzeug für Maxim. Nutzt den service_role-Key
// aus der lokalen .env (bleibt auf diesem Rechner) — läuft NIE im Browser/Server-Bundle.
// Keine dauerhafte Auth-Lösung; siehe supabase/migrations/0009_invites.sql + STATUS.
//
// So benutzt du es:
//   1. Trag deine Freunde in scripts/friends.txt ein — pro Zeile:  Name, email@beispiel.de
//      (Vorlage: scripts/friends.example.txt kopieren nach scripts/friends.txt)
//   2. Ausführen:   node scripts/make-invites.mjs
//   3. Die ausgegebenen Links pro Freund per WhatsApp verschicken.
//
// Basis-URL überschreibbar via Umgebungsvariable INVITE_BASE_URL (Default: Prod).

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ROOT = new URL("../", import.meta.url);
const BASE_URL = (process.env.INVITE_BASE_URL ?? "https://corso-app.pages.dev").replace(/\/+$/, "");

// --- .env laden (nur VITE_SUPABASE_URL + service_role-Key) ---
const env = Object.fromEntries(
  readFileSync(new URL(".env", ROOT), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("❌ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen in .env.");
  process.exit(1);
}

// --- Freundesliste lesen ---
let raw;
try {
  raw = readFileSync(new URL("scripts/friends.txt", ROOT), "utf8");
} catch {
  console.error(
    "❌ scripts/friends.txt nicht gefunden.\n" +
      "   Kopier scripts/friends.example.txt → scripts/friends.txt und trag deine Freunde ein\n" +
      "   (pro Zeile:  Name, email@beispiel.de).",
  );
  process.exit(1);
}

const friends = raw
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((line) => {
    const i = line.indexOf(",");
    if (i === -1) return null;
    const name = line.slice(0, i).trim();
    const email = line.slice(i + 1).trim();
    return name && email ? { name, email } : null;
  })
  .filter(Boolean);

if (friends.length === 0) {
  console.error("❌ Keine gültigen Zeilen in scripts/friends.txt (Format:  Name, email@beispiel.de).");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`\nErzeuge ${friends.length} Einladungs-Link(s)…\n`);

let ok = 0;
for (const { name, email } of friends) {
  const token = randomBytes(24).toString("base64url"); // 🔒 kryptografisch zufällig
  const { error } = await sb.from("invites").insert({
    token,
    friend_name: name,
    friend_email: email,
  });
  if (error) {
    console.error(`  ⚠️  ${name} <${email}>: ${error.message}`);
    continue;
  }
  ok++;
  const pad = name.padEnd(16, " ");
  console.log(`  ${pad} → ${BASE_URL}/invite/${token}`);
}

console.log(`\n✅ ${ok}/${friends.length} Links erzeugt. Gültig 7 Tage, jeder nur 1× einlösbar.\n`);
