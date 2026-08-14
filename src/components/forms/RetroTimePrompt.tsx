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
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { retroBuckets, type RetroCandidate } from "@/lib/retro-capture";

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

  if (candidates.length === 0) return null;

  const answered = Object.keys(picked).length;

  return (
    <Modal
      open={open}
      onClose={onSkip}
      title={candidates.length === 1 ? "How long did that take?" : "How long did these take?"}
    >
      <div className="space-y-4">
        <p className="text-sm" style={{ color: "var(--fg-2)" }}>
          Roughly is fine — close enough to know whether you beat the book. This
          is the only job on the ticket big enough to be worth asking about.
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
                  flags {c.flagHours.toFixed(1)}h
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
          <Button variant="ghost" onClick={onSkip} disabled={saving}>
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
