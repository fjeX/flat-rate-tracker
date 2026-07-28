"use client";

// Entry-level half of comeback logging (Unpaid Time Engine, Phase 2).
//
// Which LINES were free is marked per-line in OpCodeLines. This panel answers
// the two questions that belong to the repair order as a whole:
//
//   1. Whose comeback is it? — my own work / another tech's / same-visit rework.
//      Not derivable from the "redo of" link being empty: that single empty
//      state covers all three, and Liem's shop tracks another tech's comebacks
//      separately, so collapsing them would erase the distinction he asked for.
//   2. Which job is it a redo OF? — only askable for your own work. Another
//      tech's RO isn't in this user's data at all, and same-visit rework never
//      got a second ticket.
//
// Hidden entirely until at least one line is marked, so the log form is
// unchanged for the overwhelmingly common case of a normal paid RO.
import { Check, Link2, RotateCcw, Search, X } from "lucide-react";
import { COMEBACK_KINDS, COMEBACK_KIND_LABELS } from "@/lib/types";
import type { ComebackKind, RoMatch } from "@/lib/types";
import { formatDateLong } from "@/lib/periods";

const KIND_HINTS: Record<ComebackKind, string> = {
  comeback_own: "You're redoing a job you flagged before.",
  comeback_other: "You're cleaning up work another tech flagged.",
  rework_same_visit: "You caught it before the car left — no second ticket.",
};

export function ComebackSection({
  comebackKind,
  comebackOfEntryId,
  selectedOriginal,
  originalRoSearch,
  setOriginalRoSearch,
  originalRoMatches,
  isFindingOriginal,
  changeComebackKind,
  findOriginalRo,
  chooseOriginalRo,
  clearOriginalRo,
}: {
  comebackKind: ComebackKind | null;
  comebackOfEntryId: string | null;
  selectedOriginal: RoMatch | null;
  originalRoSearch: string;
  setOriginalRoSearch: (v: string) => void;
  originalRoMatches: RoMatch[] | null;
  isFindingOriginal: boolean;
  changeComebackKind: (kind: ComebackKind) => void;
  findOriginalRo: () => void;
  chooseOriginalRo: (match: RoMatch) => void;
  clearOriginalRo: () => void;
}) {
  return (
    <div className="step-card active">
      <div className="step-head" style={{ cursor: "default" }}>
        <div className="step-num" aria-hidden="true">
          <RotateCcw size={13} />
        </div>
        <div className="step-title">Unpaid rework</div>
        <div className="step-summary">flags 0h</div>
      </div>
      <div className="step-body">
        <p style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 10 }}>
          These lines flag zero. Log the actual hours anyway — that&apos;s the
          number that shows what the redo really cost you.
        </p>

        {/* Kind */}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend
            style={{
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--fg-3)",
              marginBottom: 6,
            }}
          >
            Whose work
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {COMEBACK_KINDS.map((kind) => {
              const on = comebackKind === kind;
              return (
                <label
                  key={kind}
                  className="cmb-kind"
                  data-on={on ? "true" : undefined}
                >
                  <input
                    type="radio"
                    name="comeback-kind"
                    value={kind}
                    checked={on}
                    onChange={() => changeComebackKind(kind)}
                  />
                  <span>
                    <span className="cmb-kind-label">
                      {COMEBACK_KIND_LABELS[kind]}
                    </span>
                    <span className="cmb-kind-hint">{KIND_HINTS[kind]}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Redo-of link — own work only */}
        {comebackKind === "comeback_own" && (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--fg-3)",
                marginBottom: 6,
              }}
            >
              Redo of (optional)
            </div>

            {comebackOfEntryId ? (
              <div className="cmb-linked">
                <Link2 size={14} aria-hidden="true" />
                <span className="grow">
                  {selectedOriginal
                    ? `RO #${originalRoSearch.trim()} · ${formatDateLong(selectedOriginal.date)}${
                        selectedOriginal.vehicleSummary
                          ? ` · ${selectedOriginal.vehicleSummary}`
                          : ""
                      }`
                    : "Linked to an earlier RO"}
                </span>
                <button
                  type="button"
                  onClick={clearOriginalRo}
                  className="cmb-unlink"
                  aria-label="Remove link to original RO"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6 }}>
                  <label htmlFor="cmb-original-ro" className="sr-only">
                    Original RO number
                  </label>
                  <input
                    id="cmb-original-ro"
                    type="text"
                    inputMode="numeric"
                    value={originalRoSearch}
                    onChange={(e) => setOriginalRoSearch(e.target.value)}
                    onKeyDown={(e) => {
                      // The log form submits on Enter; this field is a lookup,
                      // not a submit, so swallow it and search instead.
                      if (e.key === "Enter") {
                        e.preventDefault();
                        findOriginalRo();
                      }
                    }}
                    placeholder="Original RO #"
                    className="input"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={findOriginalRo}
                    disabled={!originalRoSearch.trim() || isFindingOriginal}
                    className="btn btn-ghost"
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Search size={14} aria-hidden="true" />
                    {isFindingOriginal ? "Finding…" : "Find"}
                  </button>
                </div>

                {/* RO numbers get recycled, so a search can legitimately return
                    several unrelated jobs — same reason DuplicateRoDialog
                    exists. Show date + vehicle so they're tellable apart. */}
                {originalRoMatches !== null &&
                  (originalRoMatches.length === 0 ? (
                    <p
                      style={{
                        fontSize: 12,
                        color: "var(--fg-3)",
                        marginTop: 8,
                      }}
                    >
                      No RO matching that number. You can still save — the
                      comeback is recorded either way.
                    </p>
                  ) : (
                    <div className="cmb-matches">
                      {originalRoMatches.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="cmb-match"
                          onClick={() => chooseOriginalRo(m)}
                        >
                          <span className="grow">
                            <span className="cmb-match-date">
                              {formatDateLong(m.date)}
                            </span>
                            {m.vehicleSummary && (
                              <span className="cmb-match-vehicle">
                                {m.vehicleSummary}
                              </span>
                            )}
                          </span>
                          <Check size={14} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
