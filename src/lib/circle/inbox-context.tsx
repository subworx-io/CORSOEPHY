import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useCircle } from "@/lib/circle/use-circle";
import type { CircleInboxRow, CircleMessage } from "@/lib/supabase/types";

// Der Posteingang des Circle-Chats — EIN Realtime-Kanal für die ganze App.
//
// Warum zentral und nicht im Chat-Screen: der Chat soll live sein (Backlog #18),
// ABER die App soll eine neue Nachricht auch dann melden, wenn man gerade in der
// Discovery steht (#21). Beides ist derselbe Ereignisstrom — zwei Abos wären
// zwei WebSockets für dieselben Zeilen. Deshalb hängt das Abo hier im Root, und
// der Chat-Screen liest nur noch aus dem Query-Cache, den dieser Provider füttert.
//
// 🔒 RLS trägt das Abo: circle_messages_read (0024) lässt nur die beiden Partner
// einer Verbindung an die Zeilen — Realtime prüft die Policy pro Abonnent. Es
// kommt also nichts an, was man nicht ohnehin lesen dürfte.
// 🔒 Kein Zähler: der Posteingang liefert „ungelesen ja/nein" pro Verbindung,
// nirgends eine Anzahl. Punkte, keine Zahlen — wie überall in Corso.

const INBOX_KEY = "circle-inbox";
/** Query-Key des Chat-Verlaufs — hier gefüttert, in circle-chat.tsx gelesen. */
export const chatQueryKey = (connectionId: string) => ["circle-chat", connectionId] as const;

// Rückfalllinie, falls der WebSocket wegbricht (Bahnfahrt, iOS-Hintergrund):
// der Posteingang holt sich in Ruhe trotzdem den Stand.
const INBOX_POLL_MS = 60_000;

interface CircleInboxValue {
  /** Verbindungen mit ungelesener Nachricht — als Partner-IDs (für Punkte an Chips). */
  unreadPartnerIds: Set<string>;
  /** Irgendwo im Circle liegt etwas Ungelesenes → Punkt am Nav-Tab. */
  hasUnread: boolean;
  /** Chat als gelesen markieren (serverseitig, geräteübergreifend). */
  markRead: (connectionId: string) => void;
}

const CircleInboxContext = createContext<CircleInboxValue>({
  unreadPartnerIds: new Set(),
  hasUnread: false,
  markRead: () => {},
});

export function useCircleInbox() {
  return useContext(CircleInboxContext);
}

export function CircleInboxProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { partners } = useCircle();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const { data: rows = [] } = useQuery<CircleInboxRow[]>({
    queryKey: [INBOX_KEY, user?.id],
    queryFn: async () => {
      const { data } = await supabase.rpc("circle_inbox");
      return (data ?? []) as CircleInboxRow[];
    },
    enabled: !!user,
    refetchInterval: INBOX_POLL_MS,
    refetchOnWindowFocus: true,
  });

  const markRead = useCallback(
    (connectionId: string) => {
      // Sofort im Cache löschen — der Punkt soll mit dem Öffnen weg sein, nicht
      // erst nach dem Roundtrip. Der Server ist danach die Wahrheit.
      queryClient.setQueryData<CircleInboxRow[]>([INBOX_KEY, user?.id], (old) =>
        (old ?? []).map((r) => (r.connection_id === connectionId ? { ...r, unread: false } : r)),
      );
      void supabase
        .rpc("mark_circle_read", { p_connection: connectionId })
        .then(() => queryClient.invalidateQueries({ queryKey: [INBOX_KEY, user?.id] }));
    },
    [queryClient, user?.id],
  );

  // Welcher Chat gerade offen ist — dafür soll keine Meldung aufpoppen.
  // In Refs gespiegelt, damit der Realtime-Handler stabil gebunden bleibt und
  // das Abo nicht bei jedem Routenwechsel neu aufgebaut wird.
  const search = location.search as { chat?: string };
  const openChatPartnerId =
    location.pathname === "/circle" && typeof search.chat === "string" ? search.chat : null;
  const openChatRef = useRef<string | null>(openChatPartnerId);
  openChatRef.current = openChatPartnerId;

  const handleByPartnerId = useMemo(
    () => new Map(partners.map((p) => [p.partnerId, p.displayName || p.handle])),
    [partners],
  );
  const handleRef = useRef(handleByPartnerId);
  handleRef.current = handleByPartnerId;

  const partnerByConnectionId = useMemo(
    () => new Map(partners.map((p) => [p.connectionId, p.partnerId])),
    [partners],
  );
  const partnerRef = useRef(partnerByConnectionId);
  partnerRef.current = partnerByConnectionId;

  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("circle-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "circle_messages" },
        (payload) => {
          const message = payload.new as CircleMessage;

          // Offenen Chat-Verlauf sofort ergänzen — das ist die Live-Zustellung
          // (#18). Nur, wenn der Verlauf überhaupt schon geladen wurde: sonst
          // stünde im Cache ein Verlauf aus genau einer Nachricht.
          const key = chatQueryKey(message.connection_id);
          if (queryClient.getQueryData<CircleMessage[]>(key)) {
            queryClient.setQueryData<CircleMessage[]>(key, (old) => {
              const list = old ?? [];
              if (list.some((m) => m.id === message.id)) return list;
              return [...list, message];
            });
          }

          // Eigene Nachrichten (anderes Gerät) landen im Verlauf, melden sich
          // aber nicht — man weiß ja, dass man sie geschrieben hat.
          if (message.sender_id === user.id) return;

          const partnerId = partnerRef.current.get(message.connection_id) ?? message.sender_id;

          // Chat offen → als gelesen durchwinken statt melden.
          if (openChatRef.current === partnerId) {
            markReadRef.current(message.connection_id);
            return;
          }

          void queryClient.invalidateQueries({ queryKey: [INBOX_KEY, user.id] });

          // 🔒 Nur wer geschrieben hat, kein Nachrichtentext — dieselbe Zurück-
          // haltung wie beim Push (0028). Die App kann über der Schulter
          // mitgelesen werden wie ein Sperrbildschirm.
          const name = handleRef.current.get(partnerId);
          // Seit 0035 gibt es Medien-Nachrichten. Die Meldung sagt WAS ankam,
          // 🔒 aber weiterhin nie den Inhalt — dieselbe Zurückhaltung wie der
          // Push, dessen Text seit 0035 ebenso unterscheidet.
          const what =
            message.kind === "photo"
              ? "hat dir ein Foto geschickt."
              : message.kind === "video"
                ? "hat dir ein Video geschickt."
                : message.kind === "voice"
                  ? "hat dir eine Sprachnachricht geschickt."
                  : "hat dir geschrieben.";
          toast(name ?? "Neue Nachricht", {
            description: name ? what : "Jemand aus deinem Circle hat geschrieben.",
            action: {
              label: "Öffnen",
              onClick: () =>
                void navigateRef.current({ to: "/circle", search: { chat: partnerId } }),
            },
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  const unreadPartnerIds = useMemo(
    () => new Set(rows.filter((r) => r.unread).map((r) => r.partner_id)),
    [rows],
  );

  const value = useMemo<CircleInboxValue>(
    () => ({ unreadPartnerIds, hasUnread: unreadPartnerIds.size > 0, markRead }),
    [unreadPartnerIds, markRead],
  );

  return <CircleInboxContext.Provider value={value}>{children}</CircleInboxContext.Provider>;
}
