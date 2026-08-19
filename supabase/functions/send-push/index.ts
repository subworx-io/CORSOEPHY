/* Corso — Versender für Web Push.
 *
 * Leert die Warteschlange push_outbox (0018) und schickt jede Nachricht an die
 * Geräte-Abos aus push_subscriptions (0016).
 *
 * Warum hier und nicht im Cloudflare-Worker: der service_role-Key gehört nicht
 * in den Edge (CLAUDE.md). In einer Supabase Edge Function liegt er ohnehin als
 * Umgebungsvariable bereit und verlässt Supabase nicht.
 *
 * Aufruf: POST mit Header `x-corso-push-secret`. Angestoßen von dispatch_push()
 * per pg_cron, sobald etwas in der Schlange liegt.
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_DISPATCH_SECRET
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPush, type VapidKeys } from "../_shared/webpush.ts";

interface ClaimedRow {
  outbox_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

const env = (name: string) => Deno.env.get(name) ?? "";

Deno.serve(async (request) => {
  const expected = env("PUSH_DISPATCH_SECRET");
  if (!expected || request.headers.get("x-corso-push-secret") !== expected) {
    // Bewusst wortkarg: ein Fremder erfährt nicht, ob das Secret fehlt oder falsch ist.
    return new Response("nope", { status: 401 });
  }

  const vapid: VapidKeys = {
    publicKey: env("VAPID_PUBLIC_KEY"),
    privateKey: env("VAPID_PRIVATE_KEY"),
    subject: env("VAPID_SUBJECT") || "mailto:hallo@corso.app",
  };
  if (!vapid.publicKey || !vapid.privateKey) {
    return Response.json({ error: "VAPID-Schlüssel fehlen." }, { status: 500 });
  }

  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("claim_push_batch", { p_limit: 200 });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ClaimedRow[];
  if (rows.length === 0) {
    return Response.json({ sent: 0, failed: 0, gone: 0 });
  }

  // Parallel, aber in Häppchen: 200 gleichzeitige Verbindungen zu Apple mag
  // weder die Function-Laufzeit noch der Push-Dienst.
  const CHUNK = 25;
  let sent = 0;
  let failed = 0;
  let gone = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);

    await Promise.all(
      chunk.map(async (row) => {
        const result = await sendPush(
          { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
          { title: row.title, body: row.body, url: row.url, tag: row.tag },
          vapid,
        );

        if (result.ok) sent++;
        else if (result.gone) gone++;
        else failed++;

        // Ergebnis zurückmelden: tote Abos werden gelöscht, weiche Fehler gezählt.
        await supabase.rpc("report_push_result", {
          p_outbox_id: row.outbox_id,
          p_endpoint: row.endpoint,
          p_ok: result.ok,
          p_gone: result.gone,
          p_error: result.ok ? null : `${result.status}: ${result.detail ?? ""}`,
        });
      }),
    );
  }

  return Response.json({ sent, failed, gone });
});
