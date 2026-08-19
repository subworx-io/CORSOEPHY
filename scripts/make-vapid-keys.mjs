#!/usr/bin/env node
/*
 * Corso — VAPID-Schlüsselpaar für Web Push erzeugen (RFC 8292).
 *
 * Einmalig ausführen. Das Paar identifiziert Corso gegenüber den Push-Diensten
 * von Apple, Google und Mozilla.
 *
 *   node scripts/make-vapid-keys.mjs
 *
 * ⚠️ Ein Wechsel des Schlüsselpaars macht ALLE bestehenden Abos ungültig —
 * jeder Nutzer müsste Push neu erlauben. Also einmal erzeugen und behalten.
 *
 * Bewusst ohne Abhängigkeit: ein VAPID-Schlüssel ist ein gewöhnliches
 * P-256-ECDSA-Paar, das Node selbst erzeugen kann.
 */

import { webcrypto } from "node:crypto";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

// Öffentlich: unkomprimierter Kurvenpunkt (65 Byte) — das erwartet PushManager.
const pub = b64url(await webcrypto.subtle.exportKey("raw", publicKey));
// Privat: der rohe Skalar d aus dem JWK, bereits base64url-kodiert.
const { d } = await webcrypto.subtle.exportKey("jwk", privateKey);

console.log(`
VAPID-Schlüsselpaar erzeugt. Einmalig — nicht neu erzeugen, sonst brechen alle Abos.

1) In .env (lokal) und als Cloudflare-Pages-Variable:

VITE_VAPID_PUBLIC_KEY=${pub}

2) NUR als Secret in Supabase (Dashboard → Edge Functions → Secrets).
   Niemals ins Frontend, niemals mit VITE_-Präfix, nicht committen:

VAPID_PRIVATE_KEY=${d}
VAPID_PUBLIC_KEY=${pub}
`);
