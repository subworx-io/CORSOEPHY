import { promptDayLabel } from "@/lib/prompts/prompt-history";

/**
 * Der Prompt, zu dem ein Moment entstanden ist — als Editorial-Overlay oben auf
 * der Kachel. Optik identisch zum Aufnahme-Screen (System-Serif, linksbündige
 * Magazin-Headline, Kursiv-Label, weicher Scrim statt harter Box), damit „Prompt"
 * überall gleich aussieht: Aufnahme → Discovery → Ich folge → Stadt Corso → Rücklauf.
 *
 * Der linke Einzug hält die Spalte des Ton-Buttons (top-4 left-4, 2.25rem breit)
 * frei — Label und Headline starten rechts daneben.
 * `pointer-events-none`, damit der Ton-Button darunter klickbar bleibt.
 */
export function MomentPrompt({ text, date }: { text: string; date?: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/60 via-black/25 to-transparent pl-[4.5rem] pr-6 pt-5 pb-11">
      {date && (
        <div className="font-serif text-[13px] italic text-white/55">{promptDayLabel(date)}</div>
      )}
      <h2 className="mt-1 font-serif text-[22px] font-medium leading-[1.15] tracking-[-0.01em] text-white drop-shadow-md">
        {text}
      </h2>
    </div>
  );
}
