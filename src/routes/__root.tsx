import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { DevMenu } from "../components/dev-menu";
import { Toaster } from "../components/ui/sonner";
import { useUnseenBadges } from "../hooks/use-unseen-badges";
import { HapticTapTarget } from "../components/haptic-tap";
import { CircleInboxProvider, useCircleInbox } from "../lib/circle/inbox-context";

// Zwei-Achsen-Nav (Umbau 2. Sep 2026): genau 5 Items.
// „Stadt" bündelt Discovery + „Ich folge" (Toggle im Screen), „Corso" ist der
// Stadt Corso (Nav-Label „Corso" — Entscheidung Dominik, 2. Sep; Screen-Titel
// bleibt „Stadt Corso", PRD-Begriffspaar), „Circle" ist die beständige Achse 2,
// „Du" der bisherige Rücklauf/Self-Screen.
// `festival` (Bühne mit Wimpeln) statt `movie` für den Stadt Corso — Entscheidung
// Dominik, 4. Sep 2026: „Corso" heißt Umzug/Promenade, das Ritual ist eine Bühne,
// kein Film. `movie` las sich wie ein Video-Archiv.
const TABS = [
  { to: "/" as const, label: "Stadt", icon: "explore", badge: "discovery" as const },
  { to: "/story" as const, label: "Corso", icon: "festival", badge: "story" as const },
  { to: "/record" as const, label: "Kamera", icon: "photo_camera" },
  { to: "/circle" as const, label: "Circle", icon: "group", badge: "circle" as const },
  { to: "/feedback" as const, label: "Du", icon: "person" },
];

// Kleiner weißer Punkt oben rechts am Tab: „hier gibt es etwas, das du noch nicht
// gesehen hast". Bewusst ohne Zahl — nur ein Hinweis, kein Zähler.
function UnseenDot() {
  return (
    <span className="pointer-events-none absolute top-1.5 right-1.5 flex h-2 w-2" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
    </span>
  );
}

function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const unseen = useUnseenBadges(pathname);
  // Ungelesene Circle-Nachricht → Punkt am Circle-Tab. Kommt aus demselben
  // Realtime-Kanal wie die Meldung selbst, ist also sofort da (Backlog #21).
  // 🔒 Punkt, keine Zahl — wie bei den anderen beiden Tabs.
  const { hasUnread } = useCircleInbox();
  const dots = { ...unseen, circle: hasUnread };

  // Sicherheitsnetz gegen hängengebliebene Overlay-Locks: Radix-Sheets und der
  // vaul-Drawer setzen `pointer-events: none` am <body> und räumen es bei
  // Unmount-Races nicht immer weg (bekannte Bug-Klasse, siehe dev-menu.tsx).
  // Ein Routenwechsel ist der sichere Moment zum Aufräumen — dort ist nie
  // legitim ein Overlay-Lock aktiv.
  useEffect(() => {
    document.body.style.pointerEvents = "";
  }, [pathname]);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none px-4"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 24px)" }}
    >
      <div className="pointer-events-auto inline-flex items-center gap-1 p-1.5 rounded-full bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl">
        {TABS.map((item) => {
          const isActive = pathname === item.to;
          const showDot = !isActive && item.badge != null && dots[item.badge];
          return (
            // ACHTUNG, nicht offensichtlich: Der Haptik-Schalter in den
            // Einstellungen schaltet hier auch den NAVIGATIONSWEG um. Ist die
            // Haptik an, liegt auf dem iPhone das Schalter-Element über dem
            // Link und navigiert per onTap; ist sie aus, rendert es nichts und
            // der <Link> arbeitet wieder selbst. Beide Wege müssen stimmen —
            // ein Fehler in einem davon zeigt sich nur bei einer der beiden
            // Einstellungen. Wer hier einen Navigationsfehler sucht: zuerst den
            // Haptik-Schalter umlegen und gegenprüfen.
            // Warum nicht einfach immer rendern und nur den Impuls
            // unterdrücken? Weil das Element selbst der Impuls ist — iOS gibt
            // den System-Tap beim Berühren, daran führt kein Schalter vorbei.
            <span key={item.to} className="relative inline-flex">
              <HapticTapTarget
                label={`Tab ${item.label}`}
                onTap={() => void navigate({ to: item.to })}
              />
              <Link
                to={item.to}
                // Route-Chunk laden, sobald die Nav steht (nicht erst beim Tipp):
                // besonders der Kamera-Screen fühlte sich sonst beim ersten Öffnen
                // eine halbe Sekunde „gebuffert" an (Chunk-Fetch vor dem Mount).
                preload="render"
                aria-label={showDot ? `${item.label} – Neues` : item.label}
                className={`relative flex items-center justify-center h-10 rounded-full transition-all ${
                  isActive
                    ? "bg-white text-black font-semibold px-3 gap-1.5"
                    : "text-white/70 hover:text-white w-10"
                }`}
              >
                <span
                  className="material-symbols-outlined text-[20px] leading-none"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {item.icon}
                </span>
                {isActive && <span className="text-[13px]">{item.label}</span>}
                {showDot && <UnseenDot />}
              </Link>
            </span>
          );
        })}
        {/* Nur für den Dev-Admin sichtbar (rendert sonst null) */}
        <DevMenu />
      </div>
    </nav>
  );
}

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { FollowProvider } from "../lib/follow-context";
import { AuthProvider } from "../lib/auth-context";
import { AuthGate } from "../components/auth-gate";
import { PushOptinSplash } from "../components/push-optin-splash";
import { CircleSplash } from "../components/circle-splash";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // Mobile-first viewport: kein Zoom, skaliert wie eine native App
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { title: "Corso" },
      { name: "description", content: "Deine Stadt. Jeden Abend." },
      // PWA: Als App installierbar (iOS + Android)
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Corso" },
      { name: "theme-color", content: "#0a0a0a" },
      { property: "og:title", content: "Corso" },
      { property: "og:description", content: "Deine Stadt. Jeden Abend." },
      { property: "og:type", content: "website" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // PWA Manifest
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <FollowProvider>
            {/* Ein Realtime-Kanal für den ganzen Circle-Chat: speist den offenen
                Verlauf, den Punkt an der Nav und die App-weite Meldung. Muss
                über der Nav liegen, damit der Punkt überall gilt. */}
            <CircleInboxProvider>
              <div className="h-dvh bg-neutral-950 overflow-hidden">
                <Outlet />
                <BottomNav />
                {/* Oben statt unten: unten sitzt die schwebende BottomNav, und
                    die Meldung soll sie nicht verdecken. */}
                <Toaster position="top-center" />
              </div>
              <PushOptinSplash />
              {/* Circle-Eintritt: gefeierte Ankündigung beim nächsten App-Öffnen. */}
              <CircleSplash />
            </CircleInboxProvider>
          </FollowProvider>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
