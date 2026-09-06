"use client";

// "How long did that one take?" — asked once, right after the RO is saved.
//
// The design constraints are all about NOT being the timer nag. It appears only
// for jobs at or above HEAVY_FLAG_HOURS (about one a day, not ten), it never
// blocks the save (the RO is already persisted before this renders), and Skip is
// a first-class button rather than a greyed-out escape hatch — a prompt that
// punishes dismissal gets dismissed reflexively, and then the answers that DO
// arrive are the ones nobody thought about.
//
// See lib/retro-capture.ts for why the buckets are coarse and why the book time
// is deliberately not marked on the ladder.
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { retroBuckets, type RetroCandidate } from "@/lib/retro-capture";
import { fmtHours } from "@/lib/format";

export function RetroTimePrompt({
  open,
  candidates,
  onSubmit,
  onSkip,
}: {
  open: boolean;
  candidates: RetroCandidate[];
  /** lineId → hours. Only the lines the tech actually answered. */
  onSubmit: (answers: Record<string, number>) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // This component NEVER UNMOUNTS. LogRoForm renders it unconditionally and
  // only flips `open`/`candidates` — the `return null` below is an internal
  // early return, not a parent-level unmount — so every piece of state here
  // outlives what looks like a close. `saving` was set true on "Save time" and
  // nothing ever set it back: submitRetro's finishRetro() clears the candidate
  // list and closes the modal on both the success and the swallowed-failure
  // path, but neither one can reach this component's state. The next
  // retro-eligible save in the same page session (Save & New calls resetForm(),
  // which does not remount) reopened the prompt already reading "Saving…" with
  // both buttons dead, permanently, until a navigation or reload built a fresh
  // instance. That reload is why every incident-log row said "never reproduces
  // on retry" — it was stale state, not flakiness.
  //
  // So reset on every open. The key is empty while closed, which means
  // reopening with the SAME lines re-triggers too, and it changes if the parent
  // swaps candidate sets without an intervening close. `picked` is reset for
  // the same reason: stale answers are keyed by the previous RO's lineIds, and
  // submitting them would write an estimate onto lines that aren't on screen.
  const openKey =
    open && candidates.length > 0
      ? candidates.map((c) => c.lineId).join("|")
      : "";
  const prevOpenKey = useRef("");
  useEffect(() => {
    if (openKey && openKey !== prevOpenKey.current) {
      setSaving(false);
      setPicked({});
    }
    prevOpenKey.current = openKey;
  }, [openKey]);

  if (candidates.length === 0) return null;

  const answered = Object.keys(picked).length;
  const single = candidates.length === 1;

  return (
    <Modal
      open={open}
      onClose={onSkip}
      title={single ? "How long did that take?" : "How long did these take?"}
    >
      <div className="space-y-4">
        <p className="text-sm" style={{ color: "var(--fg-2)" }}>
          Roughly is fine — close enough to know whether you beat the book.{" "}
          {single
            ? "This is the only job on the ticket big enough to be worth asking about."
            : "These are the only jobs on the ticket big enough to be worth asking about."}
        </p>

        {candidates.map((c) => {
          const buckets = retroBuckets(c.flagHours);
          const chosen = picked[c.lineId];
          return (
            <div key={c.lineId} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <span
                    className="mono text-sm font-semibold"
                    style={{ color: "var(--fg-0)" }}
                  >
                    {c.code}
                  </span>
                  {c.description && (
                    <span
                      className="ml-2 truncate text-xs"
                      style={{ color: "var(--fg-3)" }}
                    >
                      {c.description}
                    </span>
                  )}
                </div>
                <span
                  className="mono shrink-0 text-xs tabular-nums"
                  style={{ color: "var(--fg-3)" }}
                >
                  flags {fmtHours(c.flagHours)}h
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {buckets.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    onClick={() =>
                      setPicked((p) =>
                        // Tapping the chosen chip again clears it. Without this
                        // a mis-tap is unfixable without closing the whole modal
                        // and losing the other lines' answers too.
                        p[c.lineId] === b.hours
                          ? Object.fromEntries(
                              Object.entries(p).filter(([k]) => k !== c.lineId),
                            )
                          : { ...p, [c.lineId]: b.hours },
                      )
                    }
                    className={`filter-chip${chosen === b.hours ? " active" : ""}`}
                    aria-pressed={chosen === b.hours}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <p className="text-xs" style={{ color: "var(--fg-3)" }}>
          Saved as an estimate, marked as one. It shapes your own insights and
          stays out of the shared job-time averages.
        </p>

        <div className="flex gap-2 pt-1">
          {/* Never disabled. Skip is the escape hatch; if a save ever wedges,
              the one control that gets the tech out must not wedge with it. */}
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
          <Button
            onClick={() => {
              setSaving(true);
              onSubmit(picked);
            }}
            disabled={answered === 0 || saving}
          >
            {saving ? "Saving…" : "Save time"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
