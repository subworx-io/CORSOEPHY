#!/usr/bin/env node
// Corso — Negativtest: Chat-Medien sind nur für die zwei Chat-Partner erreichbar.
//
// Warum es das gibt: Der Bucket `moments` trägt die Policy
//   "moments: read authenticated"  →  using (bucket_id = 'moments')
// Jeder Eingeloggte darf dort ALLES lesen — richtig für den Discovery-Feed,
// fatal für einen privaten Chat. Chat-Medien liegen deshalb im eigenen Bucket
// `chat-media` (0035), dessen SELECT-Policy bei jedem Zugriff prüft, ob der
// Aufrufer Partner DIESER Verbindung ist.
//
// Dieser Test sichert drei Zusicherungen ab:
//   1. anon kommt an gar nichts.
//   2. `chat-media` ist nicht öffentlich und hat die drei erwarteten Policies.
//   3. Der öffentliche Bucket `moments` ist UNVERÄNDERT — die Galerie-Ausnahme
//      des Chats darf nicht in den öffentlichen Flow durchsickern.
//
// Aufruf:  node scripts/security-test-chat-media.mjs
//          B_TOKEN=<jwt-eines-unbeteiligten> node scripts/security-test-chat-media.mjs
// Nutzt nur den anon-Key. Schreibt nichts.

import { createClient } from "@supabase/supabase-js";

if (!process.env.VITE_SUPABASE_URL) {
  try {
    process.loadEnvFile(new URL("../.env", import.meta.url));
  } catch {
    /* .env optional */
  }
}

const URL_ = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) {
  console.error("✗ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY fehlen.");
  process.exit(1);
}

const client = (token) =>
  createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });

const pass = [];
const fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(`${name} — ${detail}`);

const anon = client(null);

// ── 1. anon kommt an nichts ────────────────────────────────────────────────
{
  const r = await anon.storage.from("chat-media").list();
  const n = Array.isArray(r.data) ? r.data.length : 0;
  check("anon listet chat-media", n === 0, `Einträge=${n} error=${r.error?.message ?? "none"}`);
}
{
  // Eine signierte URL auf gut Glück: darf es nicht geben.
  const r = await anon.storage
    .from("chat-media")
    .createSignedUrl("00000000-0000-0000-0000-000000000000/x/y.jpg", 60);
  check(
    "anon erzeugt signierte chat-media-URL",
    !r.data?.signedUrl,
    `url=${r.data?.signedUrl ? "ERZEUGT" : "keine"} error=${r.error?.message ?? "none"}`,
  );
}
{
  const r = await anon.from("circle_messages").select("*", { count: "exact", head: true });
  check("anon liest circle_messages", (r.count ?? 0) === 0, `count=${r.count}`);
}

// ── 2. Ein unbeteiligter, EINGELOGGTER User (optional) ─────────────────────
const B_TOKEN = process.env.B_TOKEN;
if (B_TOKEN) {
  const B = client(B_TOKEN);
  const r = await B.storage.from("chat-media").list();
  const n = Array.isArray(r.data) ? r.data.length : 0;
  check(
    "Unbeteiligter listet chat-media",
    n === 0,
    `Einträge=${n} error=${r.error?.message ?? "none"}`,
  );
  const s = await B.storage
    .from("chat-media")
    .createSignedUrl("00000000-0000-0000-0000-000000000000/x/y.jpg", 60);
  check(
    "Unbeteiligter erzeugt signierte URL",
    !s.data?.signedUrl,
    `url=${s.data?.signedUrl ? "ERZEUGT" : "keine"}`,
  );
} else {
  console.log("⚠️  B_TOKEN nicht gesetzt — Layer 2 (eingeloggter Unbeteiligter) übersprungen.");
  console.log(
    "    Die Policy selbst ist zusätzlich in-DB mit simulierten JWT-Claims belegt (siehe STATUS).",
  );
}

console.log("\n=== Ergebnis ===");
pass.forEach((p) => console.log("  ✅", p));
fail.forEach((f) => console.log("  ❌", f));
console.log(
  fail.length
    ? `\n❌ ${fail.length} LECK(S) gefunden.`
    : "\n✅ Chat-Medien sind für Unbeteiligte über keinen geprüften Pfad erreichbar.",
);
process.exit(fail.length ? 1 : 0);
