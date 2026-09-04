import { createFileRoute } from "@tanstack/react-router";
import { HapticTapTarget } from "@/components/haptic-tap";
import { useEffect, useState } from "react";
import { useCityMomentCounts } from "@/lib/city/use-city-moment-counts";
import { useFollow } from "@/lib/follow-context";
import { DiscoveryFeed } from "@/components/discovery-feed";
import { FollowingFeed } from "@/components/following-feed";

// „Stadt" (Achse 1 des Zwei-Achsen-Modells, Umbau 2. Sep 2026): EIN Menüpunkt
// mit ZWEI Feeds, umschaltbar über den halbdurchsichtigen Toggle oben —
//   Discovery  → komplett neue, fremde Menschen aus der Stadt
//   Ich folge  → Menschen, denen du folgst (einseitig, flüchtig, 24h-Verfall)
// Wem du in Discovery folgst, wandert in „Ich folge". Circle-Partner (Achse 2)
// erscheinen in keinem der beiden Feeds — sie leben im Circle-Tab.
// Die Feeds selbst: src/components/discovery-feed.tsx / following-feed.tsx.

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Corso — deine Stadt heute Abend" },
      {
        name: "description",
        content: "Jeden Abend geht deine Stadt gemeinsam spazieren. Echte Momente, echte Menschen.",
      },
      { property: "og:title", content: "Corso — deine Stadt heute Abend" },
      { property: "og:description", content: "Jeden Abend geht deine Stadt gemeinsam spazieren." },
    ],
  }),
  component: StadtPage,
});

type CityView = "discovery" | "following";

// Halbdurchsichtiger Feed-Umschalter oben im Screen (Umbau-Vorgabe).
// `dotOn`: weißer „Neu"-Punkt an einer Option (z.B. frischer Follow → Ich folge).
function FeedToggle({
  view,
  onChange,
  dotOn,
}: {
  view: CityView;
  onChange: (v: CityView) => void;
  dotOn?: CityView;
}) {
  const options: { value: CityView; label: string }[] = [
    { value: "discovery", label: "Discovery" },
    { value: "following", label: "Ich folge" },
  ];
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-black/40 p-1 backdrop-blur-md">
      {options.map((o) => (
        <span key={o.value} className="relative inline-flex">
          <HapticTapTarget label={`Ansicht ${o.label}`} onTap={() => onChange(o.value)} />
          <button
            onClick={() => onChange(o.value)}
            aria-pressed={view === o.value}
            className={`relative rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              view === o.value ? "bg-white text-black" : "text-white/70"
            }`}
          >
            {o.label}
            {dotOn === o.value && view !== o.value && (
              <span
                className="pointer-events-none absolute right-1 top-0.5 flex h-2 w-2"
                aria-hidden
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
            )}
          </button>
        </span>
      ))}
    </div>
  );
}

function StadtPage() {
  const [view, setView] = useState<CityView>("discovery");
  // Dezenter Gemeinschafts-Zähler: wachsendes Stimmungsbild der Stadt (Momente heute/gestern).
  const { data: cityCounts } = useCityMomentCounts();

  // Frischer Follow aus Discovery → weißer Punkt an „Ich folge"; verschwindet,
  // sobald der Feed angeschaut wurde.
  const { hasUnseenFollow, markFollowsSeen } = useFollow();
  useEffect(() => {
    if (view === "following") markFollowsSeen();
  }, [view, hasUnseenFollow, markFollowsSeen]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-neutral-950">
      {view === "discovery" ? <DiscoveryFeed /> : <FollowingFeed />}

      {/* Kopf: Toggle mittig. safe-area gegen Notch. */}
      <header
        className="pointer-events-none absolute top-0 left-0 right-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="flex flex-col items-center pt-3">
          <FeedToggle
            view={view}
            onChange={setView}
            dotOn={hasUnseenFollow ? "following" : undefined}
          />
        </div>
      </header>

      {/* Stimmungsbild der Stadt — kompakte Glas-Pille in der LÜCKE zwischen
          Kachel-Unterkante und Bottom-Nav (gleiche Abstands-Formel wie die Nav),
          damit sie weder den Namen noch das Bild auf der Kachel verdeckt. */}
      {view === "discovery" && cityCounts && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-30 flex justify-center"
          style={{ bottom: "calc(max(env(safe-area-inset-bottom, 0px), 24px) + 3.4rem)" }}
        >
          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-3 py-1 backdrop-blur-md">
            <span className="material-symbols-outlined text-[13px] leading-none text-white/60">
              location_on
            </span>
            <span className="text-[11px] font-medium tracking-tight text-white/85">
              {cityCounts.today} {cityCounts.today === 1 ? "Moment" : "Momente"} heute
            </span>
            <span className="text-[11px] text-white/40">· gestern {cityCounts.yesterday}</span>
          </div>
        </div>
      )}
    </div>
  );
}
