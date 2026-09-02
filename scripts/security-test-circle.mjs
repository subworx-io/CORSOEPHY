#!/usr/bin/env node
// Corso — Sicherheits-Beweis für den Circle (0024):
//   1. Der Gegenseitigkeits-Zähler (follow_mutual_days) und die Schwelle
//      (app_config) sind über KEINEN Client-Pfad lesbar — der Circle-Eintritt
//      bleibt eine Überraschung. 🔒
//   2. Chat-Nachrichten (circle_messages) sind nur für die beiden Partner der
//      Verbindung les-/schreibbar.
// Nutzt nur den anon-Key + optional zwei echte User-JWTs, KEINEN service_role-Key.
//
// Aufruf (Layer 1, ohne Login):
//   node scripts/security-test-circle.mjs
// Vollständig (Layer 2, zwei eingeloggte Test-User — Token wie in
// security-test-follows.mjs beschrieben):
//   A_TOKEN=<jwt-von-A> B_TOKEN=<jwt-von-B> node scripts/security-test-circle.mjs
//
// Exit-Code 0 = alle Schutz-Zusicherungen halten; 1 = mindestens ein Leck.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const A_TOKEN = process.env.A_TOKEN;
const B_TOKEN = process.env.B_TOKEN;

const client = (jwt) =>
  createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : {},
  });

const pass = [];
const fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(`${name} — ${detail}`);

// ---- Layer 1: unauthentifiziert (anon) sieht nichts ---------------------------
const anon = client(null);
for (const t of ["follow_mutual_days", "app_config", "circle_messages", "connections"]) {
  const r = await anon.from(t).select("*", { count: "exact", head: true });
  // Erwartung: 0 Zeilen ODER harte Fehlermeldung (permission denied) — beides dicht.
  check(
    `anon liest ${t}`,
    (r.count ?? 0) === 0,
    `count=${r.count} error=${r.error?.message ?? "none"}`,
  );
}
{
  const r = await anon.rpc("acknowledge_circle", {
    p_connection: "00000000-0000-0000-0000-000000000000",
  });
  check("anon ruft acknowledge_circle", r.error != null, `error=${r.error?.message ?? "KEINER"}`);
}

if (!A_TOKEN || !B_TOKEN) {
  console.log("\nLayer-1-Ergebnis (anon):");
  pass.forEach((p) => console.log("  ✅", p));
  fail.forEach((f) => console.log("  ❌", f));
  console.log("\n⚠️  A_TOKEN/B_TOKEN nicht gesetzt — Layer 2 (eingeloggter Angreifer) übersprungen.");
  process.exit(fail.length ? 1 : 0);
}

// ---- Layer 2: auch ein EINGELOGGTER Nutzer sieht Zähler/Schwelle nie ----------
const A = client(A_TOKEN);
const B = client(B_TOKEN);
const aId = (await A.auth.getUser(A_TOKEN)).data.user?.id;
const bId = (await B.auth.getUser(B_TOKEN)).data.user?.id;
console.log(`\nUser A = ${aId}\nUser B = ${bId}`);

// Angriff 1: A liest den eigenen Gegenseitigkeits-Zähler (auch das ist verboten —
// die Schwelle bleibt selbst dem Betroffenen verborgen).
{
  const r = await A.from("follow_mutual_days").select("*", { count: "exact", head: true });
  check(
    "A liest follow_mutual_days (auch eigene)",
    (r.count ?? 0) === 0,
    `count=${r.count} error=${r.error?.message ?? "none"}`,
  );
}
// Angriff 2: A liest die Schwelle aus app_config.
{
  const r = await A.from("app_config").select("*").eq("key", "circle_threshold");
  check(
    "A liest circle_threshold",
    (r.data ?? []).length === 0,
    `Zeilen=${(r.data ?? []).length} error=${r.error?.message ?? "none"}`,
  );
}
// Angriff 3: B liest Verbindungen, an denen er nicht beteiligt ist.
{
  const r = await B.from("connections").select("*");
  const leaked = (r.data ?? []).filter((row) => row.user_a_id !== bId && row.user_b_id !== bId);
  check("B liest fremde connections", leaked.length === 0, `Fremdzeilen=${leaked.length}`);
}
// Angriff 4: B liest Chat-Nachrichten fremder Verbindungen (alle abgreifen).
{
  const r = await B.from("circle_messages").select("*, connections!inner(user_a_id, user_b_id)");
  const rows = r.data ?? [];
  const leaked = rows.filter(
    (row) => row.connections?.user_a_id !== bId && row.connections?.user_b_id !== bId,
  );
  check(
    "B liest fremde circle_messages",
    r.error != null || leaked.length === 0,
    `Zeilen=${rows.length} Fremdzeilen=${leaked.length} error=${r.error?.message ?? "none"}`,
  );
}
// Angriff 5: B schreibt eine Nachricht in eine erfundene/fremde Verbindung.
{
  const r = await B.from("circle_messages").insert({
    connection_id: "00000000-0000-0000-0000-000000000000",
    sender_id: bId,
    body: "einbruchsversuch",
  });
  check("B schreibt in fremde Verbindung", r.error != null, `error=${r.error?.message ?? "KEINER"}`);
}
// Angriff 6: B schreibt eine Nachricht mit gefälschtem Absender (sender_id = A).
{
  const own = await B.from("connections").select("id").limit(1);
  const connId = own.data?.[0]?.id ?? "00000000-0000-0000-0000-000000000000";
  const r = await B.from("circle_messages").insert({
    connection_id: connId,
    sender_id: aId,
    body: "gefaelschter absender",
  });
  check("B fälscht sender_id", r.error != null, `error=${r.error?.message ?? "KEINER"}`);
}

console.log("\n=== Ergebnis ===");
pass.forEach((p) => console.log("  ✅", p));
fail.forEach((f) => console.log("  ❌", f));
console.log(
  fail.length
    ? `\n❌ ${fail.length} LECK(S) gefunden.`
    : "\n✅ Alle Schutz-Zusicherungen halten — Zähler, Schwelle und fremde Chats bleiben unsichtbar.",
);
process.exit(fail.length ? 1 : 0);
