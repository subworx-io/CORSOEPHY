import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useBlocks } from "@/lib/blocks/use-blocks";
import { useFollow } from "@/lib/follow-context";
import type { ReportReason } from "@/lib/supabase/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "inappropriate", label: "Unangemessener Inhalt" },
  { value: "harassment", label: "Belästigung" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Sonstiges" },
];

type View = "menu" | "report";

interface MomentMenuProps {
  reportedUserId: string;
  reportedPostId: string | null;
  handle: string;
}

// Unaufdringlicher Melde-/Block-Einstieg auf jedem Moment (Discovery, Story, "Ich folge").
// Overflow-Button → Bottom-Sheet mit "Melden" und "Blockieren" (beide ≤ 2 Taps).
export function MomentMenu({ reportedUserId, reportedPostId, handle }: MomentMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { block } = useBlocks();
  const { reset: reloadFollows } = useFollow();

  function openSheet() {
    setView("menu");
    setReason(null);
    setNote("");
    setOpen(true);
  }

  async function submitReport() {
    if (!reason || submitting) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("report_content", {
      p_reported_user_id: reportedUserId,
      p_reported_post_id: reportedPostId,
      p_reason: reason,
      p_note: note.trim(),
    });
    setSubmitting(false);
    if (error) {
      toast.error("Konnte nicht gesendet werden. Bitte erneut versuchen.");
      return;
    }
    setOpen(false);
    toast.success("Danke, wir schauen uns das an.");
  }

  async function blockUser() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await block(reportedUserId);
      // Serverseitig sind die gegenseitigen Follows weg — lokalen Follow-Stand nachziehen,
      // damit die Person sofort aus "Ich folge" fällt.
      reloadFollows();
      setOpen(false);
      toast.success(`${handle} blockiert.`);
    } catch {
      toast.error("Konnte nicht blockiert werden. Bitte erneut versuchen.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={openSheet}
        className="h-9 w-9 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Moment melden oder blockieren"
      >
        <span className="material-symbols-outlined text-white text-[18px]">more_vert</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="bg-neutral-950 text-white border-white/10">
          {view === "menu" ? (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-white">{handle}</SheetTitle>
                <SheetDescription className="text-white/50">
                  Melde diesen Moment oder blockiere die Person.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  onClick={() => setView("report")}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-4 py-3.5 text-left text-sm font-medium active:scale-[0.99] transition-transform"
                >
                  <span className="material-symbols-outlined text-[20px] text-white/70">flag</span>
                  Melden
                </button>
                <button
                  onClick={blockUser}
                  disabled={submitting}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-4 py-3.5 text-left text-sm font-medium text-red-300 active:scale-[0.99] transition-transform disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">block</span>
                  Blockieren
                </button>
              </div>
            </>
          ) : (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-white">Moment melden</SheetTitle>
                <SheetDescription className="text-white/50">
                  Warum meldest du diesen Moment?
                </SheetDescription>
              </SheetHeader>
              <RadioGroup
                value={reason ?? undefined}
                onValueChange={(v) => setReason(v as ReportReason)}
                className="mt-4 flex flex-col gap-1"
              >
                {REASONS.map((r) => (
                  <label
                    key={r.value}
                    htmlFor={`reason-${r.value}`}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 active:bg-white/[0.04] cursor-pointer"
                  >
                    <RadioGroupItem id={`reason-${r.value}`} value={r.value} />
                    <span className="text-sm">{r.label}</span>
                  </label>
                ))}
              </RadioGroup>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional: kurze Beschreibung"
                className="mt-3 bg-white/[0.04] border-white/10 text-white placeholder:text-white/30"
                rows={3}
              />
              <div className="mt-4 flex flex-col gap-2">
                <Button
                  onClick={submitReport}
                  disabled={!reason || submitting}
                  className="w-full"
                >
                  Absenden
                </Button>
                <button
                  onClick={blockUser}
                  disabled={submitting}
                  className="w-full rounded-md py-2.5 text-sm font-medium text-red-300 active:scale-[0.99] transition-transform disabled:opacity-50"
                >
                  Person zusätzlich blockieren
                </button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
