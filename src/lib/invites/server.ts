// Corso — Einladungs-Links einlösen (serverseitig, Cloudflare-Worker)
//
// ⚠️ PILOT-PROVISORIUM. E-Mail-freier Login für den Freundes-Pilot. KEINE dauerhafte
// Auth-Architektur — der zahlende Fremden-Pilot bekommt echte Self-Service-Registrierung.
// Nicht als Fundament weiterbenutzen. Siehe supabase/migrations/0009_invites.sql + STATUS.
//
// 🔒 Diese Datei läuft AUSSCHLIESSLICH serverseitig (CF-Worker). Sie nutzt den
//    service_role-Key (Server-Umgebung, kein VITE_-Präfix → nie im Client-Bundle).
//    Nach draußen geht nur der einmalige Supabase-Login-Link (action_link) — dieselbe
//    Vertrauensstufe wie ein normaler Magic-Link, NICHT der Key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") {
  throw new Error("invites/server.ts darf nicht im Browser geladen werden (service_role key!).");
}

/**
 * Env-Zugriff, der auf Cloudflare UND lokal funktioniert.
 *
 * Auf Cloudflare hängen Secrets am `env`-Binding des Workers. Nitro reicht dieses
 * Objekt NICHT an den Server-Entry durch (der SSR-Service wird mit `fetch(request)`
 * aufgerufen — ein Argument), legt es aber als `globalThis.__env__` ab. `process.env`
 * wird von Cloudflare nur befüllt, wenn nodejs_compat aktiv UND das Compatibility-Date
 * neu genug ist — darauf darf sich der Pilot nicht verlassen.
 * Deshalb: erst das CF-Binding, dann process.env (lokale .env / Node).
 */
function serverEnv(name: string): string | undefined {
  const bag = (globalThis as { __env__?: Record<string, string | undefined> }).__env__;
  const fromCloudflare = bag?.[name];
  if (typeof fromCloudflare === "string" && fromCloudflare.length > 0) return fromCloudflare;
  const fromProcess = (process.env ?? {})[name];
  return typeof fromProcess === "string" && fromProcess.length > 0 ? fromProcess : undefined;
}

// URL ist öffentlich (steht bereits im Client-Bundle) → Fallback ok. Der KEY kommt
// ausschließlich aus der Server-Umgebung (CF-Secret / lokale .env).
const SUPABASE_URL_FALLBACK = "https://uuhrylkvwosflyypbdbj.supabase.co";

function admin(): SupabaseClient {
  const key = serverEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY fehlt in der Server-Umgebung (CF-Pages-Secret nicht gesetzt).",
    );
  }
  return createClient(serverEnv("VITE_SUPABASE_URL") ?? SUPABASE_URL_FALLBACK, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Fehlertext für die URL entschärfen: einzeilig, gekürzt, ohne Steuerzeichen. */
function short(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
}

/**
 * Selbsttest ohne Nebenwirkungen: prüft die drei Dinge, an denen das Einlösen scheitern
 * kann — Key vorhanden, Key darf an die `invites`-Tabelle, Key darf die Auth-Admin-API
 * benutzen. Verrät nie den Key selbst, schreibt nichts, verbraucht keinen Einladungs-Link.
 *
 * Der dritte Test ist der wichtige: ein Key kann für die Datenbank gültig sein und für
 * `generateLink` trotzdem nicht reichen. Ohne diesen Check merkt man das erst, wenn ein
 * echter Freund vor der Fehlerseite steht.
 *
 * Aufruf: https://corso-app.pages.dev/invite/__check
 */
async function healthCheck(): Promise<Response> {
  const key = serverEnv("SUPABASE_SERVICE_ROLE_KEY");
  const keySource = (globalThis as { __env__?: Record<string, unknown> }).__env__
    ?.SUPABASE_SERVICE_ROLE_KEY
    ? "cloudflare-binding"
    : (process.env ?? {}).SUPABASE_SERVICE_ROLE_KEY
      ? "process.env"
      : "nicht gefunden";

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

  if (!key) {
    return json(
      {
        ok: false,
        schritt1_schluesselGefunden: false,
        keySource,
        hinweis:
          "Kein Schlüssel. Setzen mit: npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name corso-app — danach einmal neu deployen (bash scripts/deploy.sh).",
      },
      503,
    );
  }

  const sb = admin();

  // Test 2: Darf der Key die invites-Tabelle lesen? (nur zählen, keine Tokens ausgeben)
  const { error: dbErr, count } = await sb
    .from("invites")
    .select("id", { count: "exact", head: true });

  // Test 3: Darf der Key die Auth-Admin-API? Genau die braucht generateLink.
  //         listUsers ist lesend — legt niemanden an, verschickt keine Mail.
  const { error: authErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1 });

  const ok = !dbErr && !authErr;
  return json(
    {
      ok,
      schritt1_schluesselGefunden: true,
      schritt2_datenbankZugriff: dbErr ? `FEHLER: ${short(dbErr.message)}` : "ok",
      schritt3_authAdminZugriff: authErr ? `FEHLER: ${short(authErr.message)}` : "ok",
      keySource,
      keyLength: key.length, // Plausibilität (echter Key ist lang), nie der Inhalt
      keyTyp: key.startsWith("sb_secret_")
        ? "neuer Secret Key"
        : key.startsWith("eyJ")
          ? "alter service_role JWT"
          : "unbekanntes Format",
      offeneEinladungen: typeof count === "number" ? count : null,
      supabaseUrl: serverEnv("VITE_SUPABASE_URL") ?? `${SUPABASE_URL_FALLBACK} (Fallback)`,
      hinweis: ok
        ? "Alles grün. Einladungs-Links funktionieren jetzt."
        : "Der Schlüssel ist da, reicht aber nicht. Siehe schritt2/schritt3 oben.",
    },
    ok ? 200 : 503,
  );
}

/**
 * Löst einen Einladungs-Link ein: prüft das Token, legt bei Erfolg (via Supabase)
 * einen Login-Link an, markiert das Token als verbraucht und leitet zum Supabase-
 * Verify weiter (dort wird die Session gesetzt und zur App zurückgeleitet).
 *
 * Fehler münden in einen Redirect auf `/?invite_error=<code>` (invalid|expired|used|error).
 * Bei `error` kommt zusätzlich `&why=<stelle>&detail=<kurztext>` mit — sonst sähen alle
 * vier möglichen Ursachen (kein Key, Lesefehler, Claim-Fehler, generateLink-Fehler)
 * für Maxim identisch aus und der Flow scheitert still.
 */
export async function redeemInvite(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const token = decodeURIComponent(
    url.pathname.replace(/^\/invite\//, "").replace(/\/+$/, ""),
  ).trim();

  if (token === "__check") return await healthCheck();

  const fail = (code: "invalid" | "expired" | "used" | "error", why?: string, detail?: string) => {
    const target = new URL("/", origin);
    target.searchParams.set("invite_error", code);
    if (why) target.searchParams.set("why", why);
    if (detail) target.searchParams.set("detail", detail);
    return Response.redirect(target.toString(), 302);
  };

  if (!token) return fail("invalid");

  let sb: SupabaseClient;
  try {
    sb = admin();
  } catch (e) {
    console.error("[invite] admin-Client:", e);
    return fail("error", "nokey", short(e));
  }

  // 1) Lesen — für präzise Fehlermeldung (nicht gefunden / abgelaufen / schon benutzt).
  const { data: invite, error: readErr } = await sb
    .from("invites")
    .select("id, friend_email, expires_at, redeemed_at")
    .eq("token", token)
    .maybeSingle();

  if (readErr) {
    console.error("[invite] lesen:", readErr);
    return fail("error", "dbread", short(readErr.message));
  }
  if (!invite) return fail("invalid");
  if (invite.redeemed_at) return fail("used");
  if (new Date(invite.expires_at as string) <= new Date()) return fail("expired");

  // 2) Atomar „beanspruchen" — schützt gegen Doppelklick/Race: nur wenn noch offen
  //    und nicht abgelaufen, wird redeemed_at gesetzt.
  const { data: claimed, error: claimErr } = await sb
    .from("invites")
    .update({ redeemed_at: new Date().toISOString() })
    .eq("token", token)
    .is("redeemed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, friend_email")
    .maybeSingle();

  if (claimErr) {
    console.error("[invite] beanspruchen:", claimErr);
    return fail("error", "claim", short(claimErr.message));
  }
  if (!claimed) return fail("used"); // zwischen Lesen und Update von jemand anderem eingelöst

  try {
    // 3) Einmal-Login-Link erzeugen. `magiclink` legt den User bei Bedarf selbst an
    //    (GoTrue schaltet intern auf Signup um, solange Signups erlaubt sind).
    //    service_role bleibt hier im Worker.
    const { data, error: linkErr } = await sb.auth.admin.generateLink({
      type: "magiclink",
      email: claimed.friend_email as string,
      options: { redirectTo: origin },
    });
    if (linkErr || !data?.properties?.action_link) {
      throw linkErr ?? new Error("kein action_link erhalten");
    }

    // 4) redeemed_by nachtragen (nur Buchhaltung; unkritisch, falls es fehlt).
    await sb.from("invites").update({ redeemed_by: data.user?.id ?? null }).eq("id", claimed.id);

    // 5) Weiter zum Supabase-Verify → setzt die Session und leitet zur App zurück.
    //    Nach außen geht nur dieser einmalige Link, nicht der service_role-Key.
    return Response.redirect(data.properties.action_link, 302);
  } catch (e) {
    console.error("[invite] einlösen fehlgeschlagen:", e);
    // Un-claim: ein transienter Fehler soll den Invite nicht verbrennen.
    await sb.from("invites").update({ redeemed_at: null, redeemed_by: null }).eq("id", claimed.id);
    return fail("error", "link", short(e));
  }
}
