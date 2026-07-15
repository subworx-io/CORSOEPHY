import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Gemeinsames Gerüst der drei Rechts-Platzhalterseiten (Impressum, Datenschutz,
 * AGB). Struktur jetzt, Inhalt später — der eigentliche Rechtstext wird hier
 * eingesetzt, sobald er vorliegt.
 */
export function LegalPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      className="relative h-dvh w-full bg-neutral-950 text-white overflow-y-auto"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 7rem)",
      }}
    >
      <div className="mx-auto max-w-[600px] px-6">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-sm text-white/50 hover:text-white/80 active:scale-95 transition"
        >
          <span className="material-symbols-outlined text-[20px] leading-none">arrow_back</span>
          Einstellungen
        </Link>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>

        {children ?? (
          <p className="mt-4 text-sm leading-relaxed text-white/40">
            Inhalt folgt. Dieser Text wird vor dem öffentlichen Start ergänzt.
          </p>
        )}
      </div>
    </div>
  );
}
