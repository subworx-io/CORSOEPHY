import { useCallback, useEffect, useRef, useState } from "react";
import { HapticTapTarget } from "@/components/haptic-tap";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { chatQueryKey, useCircleInbox } from "@/lib/circle/inbox-context";
import type { CirclePartner } from "@/lib/circle/use-circle";
import { CIRCLE_MESSAGE_COLUMNS, type CircleMessage } from "@/lib/supabase/types";
import { ChatAttachment } from "@/components/chat-attachment";
import { useChatReplySwipe } from "@/components/chat-reply-swipe";
import { useVoiceRecorder, type VoiceRecording } from "@/hooks/use-voice-recorder";
import {
  uploadChatMedia,
  removeChatMedia,
  getChatMediaUrls,
  type ChatAttachment as ChatAttachmentMeta,
} from "@/lib/circle/chat-media";
import { haptic } from "@/lib/haptics";

// Der verdiente Chat (PRD §4.8, Ausgestaltung 2. Sep 2026): lebt AUSSCHLIESSLICH
// im Circle. Serverseitig erzwungen — circle_messages nimmt nur Nachrichten
// zwischen den beiden Partnern einer bestehenden Verbindung an (RLS + Block-
// Trigger, Migration 0024). Diese Komponente ist nur die Oberfläche dazu.
//
// Live seit 0028 (Backlog #18): eingehende Nachrichten kommen per Supabase
// Realtime an. Das Abo liegt bewusst NICHT hier, sondern zentral im
// CircleInboxProvider — es ist derselbe Ereignisstrom, aus dem auch die
// App-weite Meldung gespeist wird (#21). Der Provider schreibt neue Nachrichten
// direkt in genau diesen Query-Cache; hier steht deshalb nur noch das Laden des
// Verlaufs und ein langsamer Poll als Rückfalllinie, falls der WebSocket
// wegbricht (Funkloch, iOS-Hintergrund).
//
// Medien und Antworten seit 9. Sep 2026 (Migration 0035):
//   - Foto, Video und Sprachnachricht. 🔒 Anhänge liegen im PRIVATEN Bucket
//     `chat-media`; eine signierte URL bekommt nur, wer laut Storage-Policy
//     Partner dieser Verbindung ist. Ein Dritter erhält keine URL, nicht bloß
//     eine ausgeblendete Kachel.
//   - GALERIE-AUSNAHME: Hier — und NUR hier — darf eine Datei aus der Galerie
//     kommen. Der öffentliche Flow (Corso/Discovery/„Ich folge") behält die
//     🔒 Live-Kamera-Pflicht unverändert; er läuft über use-camera.ts →
//     lib/supabase/upload.ts → Bucket `moments` → posts und wird von hier nie
//     berührt. Das `<input type="file">` unten ist das einzige der App.
//   - Antworten per Zieh-Geste (chat-reply-swipe.tsx).
//
// Bewusst simpel für den Pilot: keine Read-Receipts, kein Edit/Delete.
const FALLBACK_POLL_MS = 30_000;

const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function CircleChat({ partner, onClose }: { partner: CirclePartner; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { markRead } = useCircleInbox();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Nachricht, auf die geantwortet wird (Zieh-Geste oder Zitat-Tap). */
  const [replyTo, setReplyTo] = useState<CircleMessage | null>(null);
  /** Foto im Vollbild — reiner Betrachter, kein Download. */
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();
  /** Wisch-nach-links beim Halten = abbrechen. */
  const voiceStartXRef = useRef(0);
  const [voiceCancelling, setVoiceCancelling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useQuery<CircleMessage[]>({
    queryKey: chatQueryKey(partner.connectionId),
    queryFn: async () => {
      const { data } = await supabase
        .from("circle_messages")
        .select(CIRCLE_MESSAGE_COLUMNS)
        .eq("connection_id", partner.connectionId)
        .order("created_at", { ascending: true })
        .limit(500);
      return (data ?? []) as CircleMessage[];
    },
    enabled: !!user,
    refetchInterval: FALLBACK_POLL_MS,
  });

  // Offener Chat = gelesen. Beim Öffnen und bei jeder neuen Nachricht, die
  // währenddessen eintrifft — der Punkt an der Nav soll gar nicht erst angehen,
  // solange man auf den Verlauf schaut.
  const lastMessageId = messages.length ? messages[messages.length - 1].id : null;
  useEffect(() => {
    markRead(partner.connectionId);
  }, [markRead, partner.connectionId, lastMessageId]);

  // Ans Ende scrollen, wenn Nachrichten dazukommen (und beim Öffnen).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  /**
   * Eine Nachricht schreiben. Text, Anhang oder beides — und optional als
   * Antwort auf eine andere Nachricht DIESES Chats (serverseitig geprüft, 0035).
   */
  async function insertMessage(opts: { body: string; attachment?: ChatAttachmentMeta | null }) {
    if (!user) return false;
    const { body, attachment } = opts;
    const { data, error } = await supabase
      .from("circle_messages")
      .insert({
        connection_id: partner.connectionId,
        sender_id: user.id,
        body,
        kind: attachment?.kind ?? "text",
        attachment_path: attachment?.path ?? null,
        attachment_mime: attachment?.mime ?? null,
        attachment_bytes: attachment?.bytes ?? null,
        duration_ms: attachment?.durationMs ?? null,
        width: attachment?.width ?? null,
        height: attachment?.height ?? null,
        reply_to: replyTo?.id ?? null,
      })
      .select(CIRCLE_MESSAGE_COLUMNS)
      .single();

    if (error || !data) {
      // Häufigster echter Fall: Block in eine der beiden Richtungen (Trigger).
      if (attachment) await removeChatMedia(attachment.path);
      setSendError("Nachricht konnte nicht gesendet werden.");
      return false;
    }

    // Direkt in den Verlauf hängen. Das Realtime-Echo derselben Zeile kommt
    // gleich noch hinterher — beide Wege deduplizieren über die id.
    const message = data as unknown as CircleMessage;
    queryClient.setQueryData<CircleMessage[]>(chatQueryKey(partner.connectionId), (old) => {
      const list = old ?? [];
      if (list.some((m) => m.id === message.id)) return list;
      return [...list, message];
    });
    setReplyTo(null);
    return true;
  }

  const insertMessageRef = useRef(insertMessage);
  insertMessageRef.current = insertMessage;

  async function send() {
    const body = draft.trim();
    if (!body || !user || sending) return;
    setSending(true);
    setSendError(null);
    // Eingabe sofort leeren — der Absender soll nicht auf den Roundtrip warten,
    // um weiterzutippen. Bei einem Fehler kommt der Text zurück ins Feld.
    setDraft("");
    const ok = await insertMessage({ body });
    setSending(false);
    if (!ok) setDraft(body);
  }

  /**
   * Datei aus der Galerie (oder der Kamera-App). 🔒 Diese Ausnahme von der
   * Live-Kamera-Pflicht gilt ausschließlich im Chat — siehe Kopfkommentar.
   */
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // dieselbe Datei soll erneut wählbar sein
    if (!file || !user || uploading) return;
    const kind = file.type.startsWith("video/") ? "video" : "photo";
    setUploading(true);
    setSendError(null);
    const { attachment, error } = await uploadChatMedia({
      file,
      kind,
      connectionId: partner.connectionId,
      senderId: user.id,
    });
    if (!attachment) {
      setUploading(false);
      setSendError(error ?? "Der Anhang konnte nicht gesendet werden.");
      return;
    }
    await insertMessage({ body: "", attachment });
    setUploading(false);
  }

  /** Eine fertige Aufnahme hochladen und als Nachricht schreiben. */
  const sendVoice = useCallback(
    async (rec: VoiceRecording | null) => {
      if (!rec || !user) return;
      setUploading(true);
      const { attachment, error } = await uploadChatMedia({
        file: rec.blob,
        kind: "voice",
        connectionId: partner.connectionId,
        senderId: user.id,
        durationMs: rec.durationMs,
      });
      if (!attachment) {
        setUploading(false);
        setSendError(error ?? "Die Sprachnachricht konnte nicht gesendet werden.");
        return;
      }
      await insertMessageRef.current({ body: "", attachment });
      setUploading(false);
    },
    [partner.connectionId, user],
  );

  // Bei 2 Minuten beendet der Recorder von selbst. Ohne diese Verdrahtung wäre
  // die Aufnahme an dieser Stelle still verschwunden: das Loslassen findet dann
  // keine laufende Aufnahme mehr und täte nichts.
  const { onAutoStop } = voice;
  useEffect(() => {
    onAutoStop((rec) => {
      setVoiceCancelling(false);
      void sendVoice(rec);
    });
  }, [onAutoStop, sendVoice]);

  /** Sprachnachricht: Halten nimmt auf, Loslassen sendet, Wisch nach links bricht ab. */
  async function finishVoice(cancelled: boolean) {
    setVoiceCancelling(false);
    if (cancelled) {
      voice.cancel();
      return;
    }
    await sendVoice(await voice.stop());
  }

  // ── Signierte URLs für alle Anhänge im Verlauf ───────────────────────────
  const attachmentPaths = messages.map((m) => m.attachment_path).filter((p): p is string => !!p);
  const pathKey = attachmentPaths.join("|");
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!attachmentPaths.length) return;
    let cancelled = false;
    void getChatMediaUrls(attachmentPaths).then((urls) => {
      if (!cancelled) setMediaUrls((prev) => ({ ...prev, ...urls }));
    });
    return () => {
      cancelled = true;
    };
    // pathKey statt des Arrays: sonst liefe der Effekt bei jedem Render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey]);

  // ── Zieh-zum-Antworten ───────────────────────────────────────────────────
  const byId = new Map(messages.map((m) => [m.id, m]));
  const { rowRef } = useChatReplySwipe((id) => {
    const target = byId.get(id);
    if (!target) return;
    haptic("tap");
    setReplyTo(target);
  });

  /** Tap auf ein Zitat springt zur Originalnachricht. */
  function jumpTo(messageId: string) {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate([{ background: "rgba(255,255,255,0.16)" }, { background: "rgba(255,255,255,0)" }], {
      duration: 1200,
      easing: "ease-out",
    });
  }

  /** Kurzfassung einer zitierten Nachricht. */
  function quoteLabel(m: CircleMessage): string {
    if (m.kind === "photo") return "Foto";
    if (m.kind === "video") return "Video";
    if (m.kind === "voice") return "Sprachnachricht";
    return m.body;
  }

  const name = partner.displayName || partner.handle;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-neutral-950 text-white">
      {/* Kopf: zurück + Partner */}
      <header
        className="flex items-center gap-3 border-b border-white/10 px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <span className="relative inline-flex">
          <HapticTapTarget label="Chat schließen" onTap={onClose} />
          <button
            onClick={onClose}
            aria-label="Chat schließen"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 transition-transform active:scale-95"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight">{name}</p>
          <p className="truncate text-[11px] text-white/40">{partner.handle} · in deinem Circle</p>
        </div>
      </header>

      {/* Verlauf */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="material-symbols-outlined text-[32px] text-white/25">forum</span>
            <p className="max-w-[16rem] text-sm leading-snug text-white/40">
              Noch keine Nachrichten. Ihr habt euch immer wieder gewählt — sag Hallo.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => {
              const mine = m.sender_id === user?.id;
              const quoted = m.reply_to ? byId.get(m.reply_to) : undefined;
              const hasAttachment = !!m.attachment_path;
              return (
                <div
                  key={m.id}
                  id={`msg-${m.id}`}
                  ref={rowRef(m.id)}
                  className={`relative flex rounded-2xl ${mine ? "justify-end" : "justify-start"}`}
                  style={{ touchAction: "pan-y" }}
                >
                  {/* Antwort-Pfeil blendet mit dem Zug ein (--reply-progress
                      setzt die Geste, siehe chat-reply-swipe.tsx). */}
                  <span
                    className="pointer-events-none absolute left-[-2rem] top-1/2 -translate-y-1/2"
                    style={{ opacity: "var(--reply-progress, 0)" }}
                    aria-hidden
                  >
                    <span className="material-symbols-outlined text-[18px] text-white/60">
                      reply
                    </span>
                  </span>

                  <div
                    className={`max-w-[75%] overflow-hidden rounded-2xl ${
                      hasAttachment && m.kind !== "voice" ? "p-1.5" : "px-3.5 py-2"
                    } ${
                      mine
                        ? "rounded-br-md bg-white text-black"
                        : "rounded-bl-md bg-white/10 text-white"
                    }`}
                  >
                    {/* Zitat — Tap springt zur Originalnachricht. */}
                    {m.reply_to && (
                      <button
                        onClick={() => jumpTo(m.reply_to!)}
                        className={`mb-1.5 flex w-full items-stretch gap-2 rounded-lg px-2 py-1.5 text-left ${
                          mine ? "bg-black/8" : "bg-white/10"
                        } ${hasAttachment && m.kind !== "voice" ? "mx-0.5 mt-0.5" : ""}`}
                      >
                        <span
                          className={`w-0.5 shrink-0 rounded-full ${mine ? "bg-black/40" : "bg-white/50"}`}
                        />
                        <span
                          className={`line-clamp-2 text-[12px] leading-snug ${
                            mine ? "text-black/55" : "text-white/55"
                          }`}
                        >
                          {quoted ? quoteLabel(quoted) : "Nachricht"}
                        </span>
                      </button>
                    )}

                    {hasAttachment && (
                      <ChatAttachment
                        message={m}
                        url={m.attachment_path ? mediaUrls[m.attachment_path] : undefined}
                        mine={mine}
                        onOpenPhoto={setLightbox}
                      />
                    )}

                    {m.body.trim().length > 0 && (
                      <p
                        className={`whitespace-pre-wrap break-words text-[14px] leading-snug ${
                          hasAttachment && m.kind !== "voice" ? "px-2 pt-1.5" : ""
                        }`}
                      >
                        {m.body}
                      </p>
                    )}

                    <p
                      className={`mt-0.5 text-right text-[10px] tabular-nums ${
                        hasAttachment && m.kind !== "voice" ? "px-2 pb-0.5" : ""
                      } ${mine ? "text-black/40" : "text-white/35"}`}
                    >
                      {timeLabel(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Eingabe */}
      <div
        className="border-t border-white/10 px-4 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
      >
        {sendError && <p className="mb-2 text-center text-xs text-red-400">{sendError}</p>}

        {/* Antwort-Leiste über der Eingabe */}
        {replyTo && (
          <div className="mb-2 flex items-stretch gap-2 rounded-xl bg-white/8 px-3 py-2">
            <span className="w-0.5 shrink-0 rounded-full bg-white/50" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-white/50">
                Antwort an {replyTo.sender_id === user?.id ? "dich" : name}
              </p>
              <p className="truncate text-[12px] text-white/70">{quoteLabel(replyTo)}</p>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              aria-label="Antwort verwerfen"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 active:scale-95"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        )}

        {/* Laufende Sprachaufnahme — auf iOS gibt es dabei KEINE Haptik
            (gemessen 4. Sep 2026), deshalb muss die Anzeige es allein tragen. */}
        {voice.recording && (
          <div className="mb-2 flex items-center gap-3 rounded-xl bg-white/8 px-3 py-2.5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span className="text-[13px] tabular-nums text-white/80">
              {Math.floor(voice.elapsedMs / 60000)}:
              {String(Math.floor((voice.elapsedMs % 60000) / 1000)).padStart(2, "0")}
            </span>
            <div className="flex h-4 flex-1 items-center gap-[2px] overflow-hidden">
              {Array.from({ length: 28 }, (_, i) => (
                <div
                  key={i}
                  className="w-[2px] shrink-0 rounded-full bg-white/60"
                  style={{ height: `${3 + voice.level * 13 * (0.5 + ((i * 7) % 10) / 10)}px` }}
                />
              ))}
            </div>
            <span
              className={`shrink-0 text-[11px] ${voiceCancelling ? "text-red-400" : "text-white/40"}`}
            >
              {voiceCancelling ? "loslassen bricht ab" : "← wischen zum Abbrechen"}
            </span>
          </div>
        )}
        {voice.error && <p className="mb-2 text-center text-xs text-red-400">{voice.error}</p>}

        <div className="flex items-end gap-2">
          {/* 🔒 Das EINZIGE <input type="file"> der App. Galerie-Ausnahme, gilt
              ausschließlich im Chat — siehe Kopfkommentar. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={onPickFile}
          />
          <span className="relative inline-flex shrink-0">
            <HapticTapTarget label="Anhang" onTap={() => fileRef.current?.click()} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || voice.recording}
              aria-label="Foto oder Video senden"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 transition-transform active:scale-95 disabled:opacity-40"
            >
              <span
                className={`material-symbols-outlined text-[20px] ${uploading ? "animate-spin" : ""}`}
              >
                {uploading ? "progress_activity" : "add_photo_alternate"}
              </span>
            </button>
          </span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            placeholder="Nachricht …"
            className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-3xl border border-white/15 bg-white/8 px-4 py-3 text-[14px] leading-snug text-white placeholder:text-white/35 focus:border-white/35 focus:outline-none"
          />
          {draft.trim() ? (
            <span className="relative inline-flex shrink-0">
              <HapticTapTarget
                label="Senden"
                onTap={() => {
                  if (!draft.trim() || sending) return;
                  void send();
                }}
                disabled={sending}
              />
              <button
                onClick={() => void send()}
                disabled={sending}
                aria-label="Senden"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform active:scale-95 disabled:opacity-40"
              >
                <span
                  className={`material-symbols-outlined text-[20px] ${sending ? "animate-spin" : ""}`}
                >
                  {sending ? "progress_activity" : "arrow_upward"}
                </span>
              </button>
            </span>
          ) : (
            // Halten nimmt auf, Loslassen sendet, nach links ziehen bricht ab.
            // Pointer-Capture, damit ein abrutschender Finger die Aufnahme nicht
            // hängen lässt (dasselbe Muster wie der Auslöser im Aufnahme-Screen).
            <button
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                voiceStartXRef.current = e.clientX;
                setVoiceCancelling(false);
                void voice.start();
              }}
              onPointerMove={(e) => {
                if (!voice.recording) return;
                setVoiceCancelling(e.clientX - voiceStartXRef.current < -70);
              }}
              onPointerUp={(e) => {
                if (!voice.recording) return;
                void finishVoice(e.clientX - voiceStartXRef.current < -70);
              }}
              onPointerCancel={() => voice.recording && void finishVoice(true)}
              disabled={uploading}
              aria-label="Sprachnachricht aufnehmen (halten)"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform disabled:opacity-40 ${
                voice.recording
                  ? voiceCancelling
                    ? "scale-110 bg-red-500 text-white"
                    : "scale-110 bg-white text-black"
                  : "bg-white/10 text-white"
              }`}
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: voice.recording ? "'FILL' 1" : undefined }}
              >
                mic
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Foto im Vollbild. Bewusst ohne Download-Knopf — die Datei bleibt im
          privaten Bucket, die signierte URL läuft nach einer Stunde ab. */}
      {lightbox && (
        <button
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/95 p-4"
          aria-label="Foto schließen"
        >
          <img src={lightbox} alt="" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </div>
  );
}
