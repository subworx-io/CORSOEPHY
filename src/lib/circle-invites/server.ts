// Corso — Circle-Einladungs-Links: serverseitige Landeseite + Beitritt (CF-Worker).
//
// Ein Circle-Link (`/c/<token>`) wird an Freunde AUSSERHALB der App geschickt.
// Da Supabase-Sessions im localStorage leben (nicht in Cookies), kann der Worker
// nicht wissen, ob der Besucher schon eingeloggt ist → die Landeseite bietet
// beide Wege an:
//   - „Ich bin neu": E-Mail eintragen → POST /circle-join/<token> → der Worker
//     erzeugt per service_role einen Magic-Link (legt den Account bei Bedarf an,
//     Muster invites/server.ts) und leitet direkt zum Supabase-Verify — von dort
//     landet die Person eingeloggt in der App auf /circle-redeem/<token>.
//   - „Ich habe Corso schon": Link auf /circle-redeem/<token> (App-Route) —
//     dort löst der Client per RPC redeem_circle_invite() ein (nach Login,
//     falls nötig; das AuthGate übernimmt).
//
// 🔒 Der service_role-Key bleibt im Worker (siehe invites/server.ts). Das Token
//    wird hier NIE verbrannt — eingelöst wird ausschließlich über die RPC, wenn
//    die eingeladene Person eingeloggt ist. Nach draußen geht nur der einmalige
//    action_link.
// ⚠️ Wie die Einladungs-Links ein PILOT-PROVISORIUM: der Link erlaubt einer
//    neuen Person den App-Beitritt am Freundes-Invite-System vorbei (bewusste
//    Entscheidung Dominik, 2. Sep 2026 — Circle-Freunde bringen sich selbst mit).

import { admin, serverEnv } from "../invites/server";

if (typeof window !== "undefined") {
  throw new Error("circle-invites/server.ts darf nicht im Browser geladen werden.");
}

const APP_NAME = "Corso";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Dunkle Mini-Seite im App-Look — bewusst ohne React/Bundle (Worker-HTML). */
function page(body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${APP_NAME} — Circle-Einladung</title>
<style>
  html { background: #0a0a0a; }
  body { margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
         font-family: Inter, system-ui, -apple-system, sans-serif; color: #fff; padding: 2rem 1.5rem; box-sizing: border-box; }
  .card { width: 100%; max-width: 22rem; text-align: center; background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1); border-radius: 1.75rem; padding: 2rem 1.75rem;
          box-shadow: 0 20px 60px -20px rgba(0,0,0,0.7); }
  .eyebrow { font-size: 10px; letter-spacing: 0.4em; text-transform: uppercase; color: rgba(255,255,255,0.5); }
  h1 { font-size: 24px; line-height: 1.25; letter-spacing: -0.01em; margin: 0.9rem 0 0; }
  p  { font-size: 14px; line-height: 1.5; color: rgba(255,255,255,0.65); margin: 0.9rem 0 0; }
  input { width: 100%; box-sizing: border-box; margin-top: 1.4rem; padding: 0.8rem 1rem; border-radius: 0.75rem;
          border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: #fff; font-size: 16px; outline: none; }
  input:focus { border-color: rgba(255,255,255,0.4); }
  button { width: 100%; margin-top: 0.75rem; padding: 0.85rem 1rem; border: 0; border-radius: 0.75rem;
           background: #fff; color: #000; font-size: 15px; font-weight: 600; cursor: pointer; }
  a.alt { display: inline-block; margin-top: 1.1rem; font-size: 12px; color: rgba(255,255,255,0.45); text-decoration: none; }
  a.alt:hover { color: rgba(255,255,255,0.8); }
  .err { margin-top: 0.9rem; font-size: 13px; color: #f87171; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

const ERROR_TEXT: Record<string, string> = {
  email: "Bitte gib eine gültige E-Mail-Adresse ein.",
  link: "Beitritt gerade nicht möglich — versuch es gleich nochmal.",
};

/** GET /c/<token> — Landeseite. Zeigt, WER einlädt, und bietet beide Wege an. */
async function landingPage(token: string, origin: string, errCode?: string): Promise<Response> {
  const sb = admin();
  const { data: invite } = await sb
    .from("circle_invites")
    .select("inviter_id, expires_at, redeemed_at")
    .eq("token", token)
    .maybeSingle();

  if (!invite || new Date(invite.expires_at as string) <= new Date()) {
    return page(
      `<div class="eyebrow">${APP_NAME}</div>
       <h1>Dieser Link ist nicht mehr gültig</h1>
       <p>Circle-Links gelten für eine Person und 7 Tage. Bitte lass dir einen neuen schicken.</p>`,
      404,
    );
  }
  if (invite.redeemed_at) {
    return page(
      `<div class="eyebrow">${APP_NAME}</div>
       <h1>Dieser Link wurde schon benutzt</h1>
       <p>Ein Circle-Link gilt für genau eine Person. Bitte lass dir einen neuen schicken.</p>`,
      410,
    );
  }

  const { data: inviter } = await sb
    .from("profiles")
    .select("handle, display_name")
    .eq("id", invite.inviter_id as string)
    .maybeSingle();
  const name = esc((inviter?.display_name || inviter?.handle || "Jemand") as string);

  const err = errCode && ERROR_TEXT[errCode] ? `<p class="err">${ERROR_TEXT[errCode]}</p>` : "";

  return page(
    `<div class="eyebrow">${APP_NAME} · Circle</div>
     <h1>${name} möchte dich im Circle haben</h1>
     <p>Der Circle ist der Ort für Menschen, die bleiben — mit Chat. Tritt mit deiner E-Mail bei, dann seid ihr direkt verbunden.</p>
     ${err}
     <form method="post" action="${esc(origin)}/circle-join/${esc(token)}">
       <input type="email" name="email" placeholder="deine@email.de" autocomplete="email" required>
       <button type="submit">Beitreten</button>
     </form>
     <a class="alt" href="${esc(origin)}/circle-redeem/${esc(token)}">Ich habe Corso schon → anmelden</a>`,
  );
}

/** POST /circle-join/<token> — E-Mail-Beitritt: Magic-Link erzeugen + weiterleiten. */
async function join(token: string, request: Request, origin: string): Promise<Response> {
  const back = (code: string) =>
    Response.redirect(`${origin}/c/${encodeURIComponent(token)}?e=${code}`, 303);

  let email = "";
  try {
    const form = await request.formData();
    email = String(form.get("email") ?? "").trim().toLowerCase();
  } catch {
    return back("email");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return back("email");

  const sb = admin();
  // Token nur PRÜFEN, nicht verbrennen — eingelöst wird per RPC nach dem Login.
  const { data: invite } = await sb
    .from("circle_invites")
    .select("id, redeemed_at, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!invite || invite.redeemed_at || new Date(invite.expires_at as string) <= new Date()) {
    return Response.redirect(`${origin}/c/${encodeURIComponent(token)}`, 303);
  }

  try {
    // Magic-Link: legt neue User an (GoTrue-Signup, wie invites/server.ts) und
    // funktioniert genauso für Bestandskonten. Ziel nach dem Verify: die
    // Einlöse-Route in der App — dort entsteht die Circle-Verbindung.
    const { data, error } = await sb.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${origin}/circle-redeem/${token}` },
    });
    if (error || !data?.properties?.action_link) throw error ?? new Error("kein action_link");
    return Response.redirect(data.properties.action_link, 303);
  } catch (e) {
    console.error("[circle-invite] join:", e);
    return back("link");
  }
}

/** Router für beide Circle-Link-Pfade (vom Worker vor der SSR aufgerufen). */
export async function handleCircleInvite(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;

  const joinMatch = url.pathname.match(/^\/circle-join\/([^/]+)\/?$/);
  if (joinMatch && request.method === "POST") {
    return await join(decodeURIComponent(joinMatch[1]), request, origin);
  }

  const landMatch = url.pathname.match(/^\/c\/([^/]+)\/?$/);
  if (landMatch) {
    const err = url.searchParams.get("e") ?? undefined;
    return await landingPage(decodeURIComponent(landMatch[1]), origin, err);
  }

  return Response.redirect(origin, 302);
}
