import { useEffect, useRef, useState } from "react";
import { HapticTapTarget } from "@/components/haptic-tap";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { chatQueryKey, useCircleInbox } from "@/lib/circle/inbox-context";
import type { CirclePartner } from "@/lib/circle/use-circle";
import type { CircleMessage } from "@/lib/supabase/types";

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useQuery<CircleMessage[]>({
    queryKey: chatQueryKey(partner.connectionId),
    queryFn: async () => {
      const { data } = await supabase
        .from("circle_messages")
        .select("id, connection_id, sender_id, body, created_at")
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

  async function send() {
    const body = draft.trim();
    if (!body || !user || sending) return;
    setSending(true);
    setSendError(null);
    // Eingabe sofort leeren — der Absender soll nicht auf den Roundtrip warten,
    // um weiterzutippen. Bei einem Fehler kommt der Text zurück ins Feld.
    setDraft("");

    const { data, error } = await supabase
      .from("circle_messages")
      .insert({ connection_id: partner.connectionId, sender_id: user.id, body })
      .select("id, connection_id, sender_id, body, created_at")
      .single();

    setSending(false);
    if (error || !data) {
      // Häufigster echter Fall: Block in eine der beiden Richtungen (Trigger).
      setDraft(body);
      setSendError("Nachricht konnte nicht gesendet werden.");
      return;
    }

    // Direkt in den Verlauf hängen. Das Realtime-Echo derselben Zeile kommt
    // gleich noch hinterher — beide Wege deduplizieren über die id.
    const message = data as CircleMessage;
    queryClient.setQueryData<CircleMessage[]>(chatQueryKey(partner.connectionId), (old) => {
      const list = old ?? [];
      if (list.some((m) => m.id === message.id)) return list;
      return [...list, message];
    });
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
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
                      mine
                        ? "rounded-br-md bg-white text-black"
                        : "rounded-bl-md bg-white/10 text-white"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">
                      {m.body}
                    </p>
                    <p
                      className={`mt-0.5 text-right text-[10px] tabular-nums ${
                        mine ? "text-black/40" : "text-white/35"
                      }`}
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
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={1}
            placeholder="Nachricht …"
            className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-3xl border border-white/15 bg-white/8 px-4 py-3 text-[14px] leading-snug text-white placeholder:text-white/35 focus:border-white/35 focus:outline-none"
          />
          <span className="relative inline-flex shrink-0">
            <HapticTapTarget
              label="Senden"
              onTap={() => {
                if (!draft.trim() || sending) return;
                void send();
              }}
              disabled={!draft.trim() || sending}
            />
            <button
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
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
        </div>
      </div>
    </div>
  );
}
