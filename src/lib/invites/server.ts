// Corso — Einladungs-Links einlösen (serverseitig, Cloudflare-Worker)
//
// ⚠️ PILOT-PROVISORIUM. E-Mail-freier Login für den Freundes-Pilot. KEINE dauerhafte
// Auth-Architektur — der zahlende Fremden-Pilot bekommt echte Self-Service-Registrierung.
// Nicht als Fundament weiterbenutzen. Siehe supabase/migrations/0009_invites.sql + STATUS.
//
// 🔒 Diese Datei läuft AUSSCHLIESSLICH serverseitig (CF-Worker). Sie nutzt den
//    service_role-Key (process.env, kein VITE_-Präfix → nie im Client-Bundle).
//    Nach draußen geht nur der einmalige Supabase-Login-Link (action_link) — dieselbe
//    Vertrauensstufe wie ein normaler Magic-Link, NICHT der Key.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") {
  throw new Error("invites/server.ts darf nicht im Browser geladen werden (service_role key!).");
}

// URL ist öffentlich (steht bereits im Client-Bundle) → Fallback ok. Der KEY kommt
// ausschließlich aus der Server-Umgebung (CF-Secret / lokale .env).
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "https://uuhrylkvwosflyypbdbj.supabase.co";

function admin(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY fehlt in der Server-Umgebung (CF-Pages-Secret nicht gesetzt).",
    );
  }
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Löst einen Einladungs-Link ein: prüft das Token, legt bei Erfolg (via Supabase)
 * einen Login-Link an, markiert das Token als verbraucht und leitet zum Supabase-
 * Verify weiter (dort wird die Session gesetzt und zur App zurückgeleitet).
 *
 * Fehler münden in einen Redirect auf `/?invite_error=<code>` (invalid|expired|used|error),
 * den der LoginScreen als klare Nutzer-Meldung anzeigt.
 */
export async function redeemInvite(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const token = decodeURIComponent(
    url.pathname.replace(/^\/invite\//, "").replace(/\/+$/, ""),
  ).trim();

  const fail = (code: "invalid" | "expired" | "used" | "error") =>
    Response.redirect(`${origin}/?invite_error=${code}`, 302);

  if (!token) return fail("invalid");

  let sb: SupabaseClient;
  try {
    sb = admin();
  } catch (e) {
    console.error("[invite] admin-Client:", e);
    return fail("error");
  }

  // 1) Lesen — für präzise Fehlermeldung (nicht gefunden / abgelaufen / schon benutzt).
  const { data: invite, error: readErr } = await sb
    .from("invites")
    .select("id, friend_email, expires_at, redeemed_at")
    .eq("token", token)
    .maybeSingle();

  if (readErr) {
    console.error("[invite] lesen:", readErr);
    return fail("error");
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
    return fail("error");
  }
  if (!claimed) return fail("used"); // zwischen Lesen und Update von jemand anderem eingelöst

  try {
    // 3) Einmal-Login-Link erzeugen. `magiclink` legt den User bei Bedarf selbst an.
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
    return fail("error");
  }
}
