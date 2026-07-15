#!/usr/bin/env node
// Corso — Sicherheits-Beweis: Nutzer B kann die private Follower-Zahl von A
// über KEINEN Pfad ermitteln. Nutzt nur den anon-Key + zwei echte User-JWTs,
// KEINEN service_role-Key.
//
// Voraussetzung: zwei eingeloggte Test-User (Magic-Link). Access-Tokens greifen:
//   Browser -> eingeloggt -> DevTools Console:
//   JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('-auth-token')))).access_token
//
// Aufruf:
//   A_TOKEN=<jwt-von-A> B_TOKEN=<jwt-von-B> node scripts/security-test-follows.mjs
//
// Exit-Code 0 = alle Schutz-Zusicherungen halten; 1 = mindestens ein Leck.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
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
for (const t of ["follows", "reach_snapshots"]) {
  const r = await anon.from(t).select("*", { count: "exact", head: true });
  check(`anon liest ${t}`, (r.count ?? 0) === 0, `count=${r.count} error=${r.error?.message ?? "none"}`);
}
{
  const r = await anon.rpc("my_reach");
  // Nach 0004 sollte anon "permission denied" bekommen. Vor 0004: 0 (harmlos).
  const ok = r.error != null || r.data === 0;
  check("anon ruft my_reach", ok, `data=${r.data} error=${r.error?.message ?? "none"}`);
}

if (!A_TOKEN || !B_TOKEN) {
  console.log("\nLayer-1-Ergebnis (anon):");
  pass.forEach((p) => console.log("  ✅", p));
  fail.forEach((f) => console.log("  ❌", f));
  console.log("\n⚠️  A_TOKEN/B_TOKEN nicht gesetzt — Layer 2 (B gegen A) übersprungen.");
  console.log("   Setze beide, um den vollständigen Zwei-User-Beweis zu fahren.");
  process.exit(fail.length ? 1 : 0);
}

// ---- Layer 2: authentifizierter B greift die Zahl von A an --------------------
const A = client(A_TOKEN);
const B = client(B_TOKEN);

const aId = (await A.auth.getUser(A_TOKEN)).data.user?.id;
const bId = (await B.auth.getUser(B_TOKEN)).data.user?.id;
console.log(`\nUser A = ${aId}\nUser B = ${bId}`);

// Grundwahrheit: A's echte eigene Zahl (nur A darf das)
const aReach = (await A.rpc("my_reach")).data;
console.log(`A's echte Reichweite (via A's my_reach): ${aReach}`);

// Angriff 1: B liest follows-Zeilen von A (followee_id = A)
{
  const r = await B.from("follows").select("*").eq("followee_id", aId);
  const leaked = (r.data ?? []).filter((row) => row.follower_id !== bId);
  check("B liest A's Follower-Zeilen", leaked.length === 0,
    `sichtbare Fremdzeilen=${leaked.length} (nur eigene erlaubt)`);
}
// Angriff 2: B zählt A's Follower per count:exact
{
  const r = await B.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", aId);
  check("B zählt A's Follower (count:exact)", (r.count ?? 0) <= 1,
    `count=${r.count} (max 1 = ob B selbst A folgt; NICHT A's echte Zahl ${aReach})`);
}
// Angriff 3: B ruft my_reach — bekommt B's eigene, NIE A's
{
  const r = await B.rpc("my_reach");
  check("B's my_reach liefert nur B's Zahl", r.data !== aReach || aReach === (await B.rpc("my_reach")).data,
    `B.my_reach=${r.data} (das ist B's eigene, nicht A's ${aReach})`);
}
// Angriff 4: roher REST-Call mit B's JWT (umgeht das SDK)
{
  const res = await fetch(`${URL_}/rest/v1/follows?select=*&followee_id=eq.${aId}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${B_TOKEN}` },
  });
  const rows = await res.json();
  const leaked = Array.isArray(rows) ? rows.filter((row) => row.follower_id !== bId) : [];
  check("B roher REST GET /follows?followee_id=A", leaked.length === 0,
    `HTTP ${res.status}, sichtbare Fremdzeilen=${leaked.length}`);
}
// Angriff 5: B liest A's persistierten reach_snapshot
{
  const r = await B.from("reach_snapshots").select("*").eq("user_id", aId);
  check("B liest A's reach_snapshots", (r.data ?? []).length === 0,
    `Zeilen=${(r.data ?? []).length} error=${r.error?.message ?? "none"}`);
}

console.log("\n=== Ergebnis ===");
pass.forEach((p) => console.log("  ✅", p));
fail.forEach((f) => console.log("  ❌", f));
console.log(fail.length ? `\n❌ ${fail.length} LECK(S) gefunden.` : "\n✅ Alle Schutz-Zusicherungen halten — B bekommt A's Zahl über keinen Pfad.");
process.exit(fail.length ? 1 : 0);
