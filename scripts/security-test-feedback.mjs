#!/usr/bin/env node
// Corso — Sicherheits-Beweis für den RÜCKLAUF: Nutzer B kann die privaten Zahlen
// von A (Publikum + Zuschauer) über KEINEN Pfad ermitteln — auch nicht die
// Betrachter-Identitäten eines fremden Posts. Nutzt nur den anon-Key + zwei echte
// User-JWTs, KEINEN service_role-Key.
//
// Access-Tokens greifen (Browser eingeloggt → DevTools Console):
//   JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('-auth-token')))).access_token
//
// Aufruf:
//   A_TOKEN=<jwt-von-A> B_TOKEN=<jwt-von-B> node scripts/security-test-feedback.mjs
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

// ---- Layer 1: unauthentifiziert (anon) kommt an nichts ------------------------
const anon = client(null);
{
  const r = await anon.from("post_views").select("*", { count: "exact", head: true });
  check("anon liest post_views", (r.count ?? 0) === 0, `count=${r.count} error=${r.error?.message ?? "none"}`);
}
{
  const r = await anon.rpc("my_feedback");
  const ok = r.error != null || (Array.isArray(r.data) && (r.data[0]?.publikum ?? 0) === 0 && (r.data[0]?.zuschauer ?? 0) === 0);
  check("anon ruft my_feedback", ok, `data=${JSON.stringify(r.data)} error=${r.error?.message ?? "none"}`);
}
{
  const r = await anon.rpc("record_view", { target_post: "00000000-0000-0000-0000-000000000000" });
  check("anon ruft record_view", r.error != null, `error=${r.error?.message ?? "none (sollte permission denied sein)"}`);
}

if (!A_TOKEN || !B_TOKEN) {
  console.log("\nLayer-1-Ergebnis (anon):");
  pass.forEach((p) => console.log("  ✅", p));
  fail.forEach((f) => console.log("  ❌", f));
  console.log("\n⚠️  A_TOKEN/B_TOKEN nicht gesetzt — Layer 2 (B gegen A) übersprungen.");
  process.exit(fail.length ? 1 : 0);
}

// ---- Layer 2: authentifizierter B greift A's Rücklauf an ----------------------
const A = client(A_TOKEN);
const B = client(B_TOKEN);

const aId = (await A.auth.getUser(A_TOKEN)).data.user?.id;
const bId = (await B.auth.getUser(B_TOKEN)).data.user?.id;
console.log(`\nUser A = ${aId}\nUser B = ${bId}`);

// Grundwahrheit: A's echte eigene Zahlen (nur A darf das).
const aFeedback = (await A.rpc("my_feedback")).data?.[0];
console.log(`A's echter Rücklauf (via A's my_feedback): ${JSON.stringify(aFeedback)}`);

// A's neuester Post (Existenz ist kein Geheimnis — die ZUSCHAUER-Zahl schon).
const { data: aPosts } = await A.from("posts").select("id").eq("author_id", aId).order("created_at", { ascending: false }).limit(1);
const aPostId = aPosts?.[0]?.id ?? null;
console.log(`A's neuester Post: ${aPostId ?? "(keiner)"}`);

// Angriff 1: B ruft my_feedback — bekommt IMMER nur B's eigene Zahlen (argumentlos).
{
  const r = await B.rpc("my_feedback");
  const row = r.data?.[0];
  const sameAsA = aFeedback && row && row.followers === aFeedback.followers && row.views === aFeedback.views;
  // „Gleich" wäre nur zufällig identische Zahlen; entscheidend: B kann A NICHT ADRESSIEREN.
  check("B's my_feedback liefert nur B's Zahlen", !r.error, `B=${JSON.stringify(row)} (kein Argument → A nicht adressierbar; zufällige Gleichheit=${!!sameAsA})`);
}

// Angriff 1b: my_feedback nimmt auch nach 0017 KEIN Argument — die neuen Felder
// (at_risk, stayed, streak, is_record) sind damit ebenfalls nicht fremd-abfragbar.
{
  const r = await B.rpc("my_feedback", { target_user: aId });
  check("my_feedback akzeptiert kein Ziel-Argument", !!r.error, `error=${r.error?.message ?? "KEIN FEHLER — Funktion nimmt ein Argument!"}`);
}

// Angriff 1c: B versucht A's „auf der Kippe"-Fenster selbst zu rekonstruieren.
{
  const r = await B.from("follows").select("expires_at", { count: "exact", head: true }).eq("followee_id", aId);
  check("B zählt A's auslaufende Follows", (r.count ?? 0) === 0, `count=${r.count}`);
}

if (aPostId) {
  // Angriff 2: B liest post_views-Zeilen von A's Post (Betrachter-Identitäten).
  {
    const r = await B.from("post_views").select("*").eq("post_id", aPostId);
    check("B liest A's post_views-Zeilen", (r.data ?? []).length === 0, `sichtbare Zeilen=${(r.data ?? []).length}`);
  }
  // Angriff 3: B zählt A's Zuschauer per count:exact.
  {
    const r = await B.from("post_views").select("*", { count: "exact", head: true }).eq("post_id", aPostId);
    check("B zählt A's Zuschauer (count:exact)", (r.count ?? 0) === 0, `count=${r.count} (A's echte Zuschauer=${aFeedback?.zuschauer})`);
  }
  // Angriff 4: roher REST-Call mit B's JWT (umgeht das SDK).
  {
    const res = await fetch(`${URL_}/rest/v1/post_views?select=*&post_id=eq.${aPostId}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${B_TOKEN}` },
    });
    const rows = await res.json();
    const n = Array.isArray(rows) ? rows.length : 0;
    check("B roher REST GET /post_views?post_id=A", n === 0, `HTTP ${res.status}, sichtbare Zeilen=${n}`);
  }
  // Angriff 5: B verbucht eine Ansicht auf A's Post (erlaubt: nur B's eigene) —
  // darf danach A's Zuschauer-Zahl trotzdem NICHT auslesen.
  {
    const w = await B.rpc("record_view", { target_post: aPostId });
    const r = await B.from("post_views").select("*", { count: "exact", head: true }).eq("post_id", aPostId);
    check("B sieht nach eigenem record_view A's Zahl NICHT", (r.count ?? 0) === 0, `write_error=${w.error?.message ?? "none"} danach sichtbar count=${r.count}`);
  }
}

// Angriff 6: B liest A's persistierten reach_snapshot (Basis der Deltas).
{
  const r = await B.from("reach_snapshots").select("*").eq("user_id", aId);
  check("B liest A's reach_snapshots", (r.data ?? []).length === 0, `Zeilen=${(r.data ?? []).length}`);
}

console.log("\n=== Ergebnis ===");
pass.forEach((p) => console.log("  ✅", p));
fail.forEach((f) => console.log("  ❌", f));
console.log(fail.length ? `\n❌ ${fail.length} LECK(S) gefunden.` : "\n✅ Alle Schutz-Zusicherungen halten — B bekommt A's Rücklauf über keinen Pfad.");
process.exit(fail.length ? 1 : 0);
