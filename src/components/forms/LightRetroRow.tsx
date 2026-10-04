"use client";

// The LIGHT "how long did that take?" ask for a 1-2h job: a chip row that lives
// INSIDE the "RO saved" strip. No modal, no focus trap, nothing blocks the next
// RO. One tap saves; Skip (or just starting the next RO) makes it go away.
//
// Anti-nag rules, same as RetroTimePrompt: Skip is a first-class button that is
// never disabled, the copy asks once and never repeats, and the state lives in
// useLogRoForm (reset per save) so nothing here can go stale across Save & New.
// Only rendered for techs opted in to True Time — see useLogRoForm.
import { Button } from "@/components/ui/Button";
import type { LightRetroCandidate } from "@/lib/retro-capture";

export function LightRetroRow({
  candidate,
  status,
  savedHours,
  onAnswer,
  onSkip,
}: {
  candidate: LightRetroCandidate;
  status: "ask" | "saving" | "done";
  savedHours: number | null;
  onAnswer: (hours: number) => void;
  onSkip: () => void;
}) {
  if (status === "done" && savedHours !== null) {
    return (
      <p className="log-light-done">
        Saved {Number(savedHours.toFixed(2))}h for {candidate.code}
      </p>
    );
  }
  return (
    <div className="log-light">
      <p>How long did the {candidate.code} take?</p>
      <div className="log-chips is-tight">
        {candidate.chips.map((c) => (
          <button
            key={c.label}
            type="button"
            className="log-chip"
            disabled={status === "saving"}
            onClick={() => onAnswer(c.hours)}
          >
            {c.label}
          </button>
        ))}
        {/* Never disabled: the one control that gets the tech out can't wedge. */}
        <Button variant="quiet" onClick={onSkip}>
          Skip
        </Button>
      </div>
    </div>
  );
}
