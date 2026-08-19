/* Corso — Web Push ohne Fremdbibliothek.
 *
 * Implementiert die beiden Standards, die ein Push-Dienst (Apple, Google,
 * Mozilla) verlangt, mit den Web-Crypto-Bordmitteln von Deno:
 *
 *   RFC 8291 — Nutzlast-Verschlüsselung "aes128gcm". Ende-zu-Ende: der
 *              Push-Dienst transportiert nur Chiffrat, entschlüsseln kann
 *              ausschließlich der Browser des Empfängers.
 *   RFC 8292 — VAPID. Ein signiertes JWT weist Corso als Absender aus.
 *
 * Bewusst kein npm-Paket: das hier sind ~150 Zeilen Standard-Krypto gegen eine
 * stabile Spezifikation. Eine Abhängigkeit dafür wäre eine weitere Stelle, die
 * Zugriff auf Push-Endpunkte unserer Nutzer hätte.
 */

const encoder = new TextEncoder();

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // öffentlicher Schlüssel des Empfänger-Browsers, base64url
  auth: string; // gemeinsames Geheimnis des Abos, base64url
}

export interface VapidKeys {
  publicKey: string; // base64url, unkomprimierter P-256-Punkt (65 Byte)
  privateKey: string; // base64url, roher Skalar d (32 Byte)
  subject: string; // mailto: oder https: — der Push-Dienst will einen Kontakt
}

/* --- Kodierung ----------------------------------------------------------- */

export function b64urlDecode(value: string): Uint8Array {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/* --- HKDF (RFC 5869) ----------------------------------------------------- */

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/* --- RFC 8291: Nutzlast verschlüsseln ------------------------------------ */

/**
 * Verschlüsselt `payload` für genau ein Abo. Ergebnis ist der komplette
 * Body im Format aes128gcm: salt | rs | idlen | server-pubkey | ciphertext.
 */
async function encryptPayload(
  sub: PushSubscriptionKeys,
  payload: string,
): Promise<Uint8Array> {
  const clientPublic = b64urlDecode(sub.p256dh); // 65 Byte
  const authSecret = b64urlDecode(sub.auth); // 16 Byte

  // Ephemeres Schlüsselpaar — pro Nachricht neu, das ist der Sinn der Übung.
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const serverPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeys.publicKey),
  );

  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, serverKeys.privateKey, 256),
  );

  // Schritt 1: das gemeinsame Geheimnis des Abos bindet die beiden
  // öffentlichen Schlüssel aneinander (RFC 8291 §3.3).
  const ikm = await hkdf(
    authSecret,
    sharedSecret,
    concat(encoder.encode("WebPush: info\0"), clientPublic, serverPublic),
    32,
  );

  // Schritt 2: daraus Inhaltsschlüssel und Nonce (RFC 8188).
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 ist der Datensatz-Abschluss („letzter Record"), kein Füllbyte.
  const plaintext = concat(encoder.encode(payload), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext),
  );

  // Record-Größe: ein einziger Record, größer als die Nutzlast.
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);

  return concat(salt, recordSize, new Uint8Array([serverPublic.length]), serverPublic, ciphertext);
}

/* --- RFC 8292: VAPID-Kopfzeile ------------------------------------------- */

async function importVapidPrivateKey(vapid: VapidKeys): Promise<CryptoKey> {
  // Web Crypto will den privaten Schlüssel als JWK — x und y stecken im
  // öffentlichen Punkt (0x04 | x | y), d ist der Skalar.
  const publicPoint = b64urlDecode(vapid.publicKey);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: b64urlEncode(publicPoint.slice(1, 33)),
      y: b64urlEncode(publicPoint.slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function vapidHeader(endpoint: string, vapid: VapidKeys): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = b64urlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    encoder.encode(
      JSON.stringify({
        aud: audience,
        // 12 Stunden. Apple lehnt alles über 24 Stunden ab.
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  );

  const signingInput = encoder.encode(`${header}.${claims}`);
  const key = await importVapidPrivateKey(vapid);
  // Web Crypto liefert die Signatur bereits als r|s (64 Byte) — genau das
  // will JWS. Kein DER-Umbau nötig.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signingInput),
  );

  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/* --- Versand ------------------------------------------------------------- */

export interface PushResult {
  ok: boolean;
  status: number;
  /** true = das Abo ist endgültig tot (404/410) und gehört gelöscht. */
  gone: boolean;
  detail?: string;
}

export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: unknown,
  vapid: VapidKeys,
  ttlSeconds = 6 * 60 * 60,
): Promise<PushResult> {
  try {
    const body = await encryptPayload(sub, JSON.stringify(payload));
    const auth = await vapidHeader(sub.endpoint, vapid);

    const response = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        // Nach TTL verwirft der Dienst die Nachricht. Ein 21:00-Ritual ist am
        // nächsten Morgen wertlos — lieber verfallen lassen als nachliefern.
        TTL: String(ttlSeconds),
        Urgency: "normal",
      },
      body,
    });

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      gone: response.status === 404 || response.status === 410,
      detail: response.ok ? undefined : (await response.text()).slice(0, 300),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      gone: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
