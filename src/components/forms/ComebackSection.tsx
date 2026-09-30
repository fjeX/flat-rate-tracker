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
import { RotateCcw } from "lucide-react";
import { COMEBACK_KINDS, COMEBACK_KIND_LABELS } from "@/lib/types";
import type { ComebackKind, RoMatch } from "@/lib/types";
import { formatDateLong } from "@/lib/periods";
import { LogIcon } from "./logParts";

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
    <div className="log-step">
      <div className="log-step-head">
        <span className="log-step-no is-icon" aria-hidden="true">
          <RotateCcw size={14} />
        </span>
        <h3 className="log-step-title">Unpaid rework</h3>
        <span className="log-step-aside">flags <span className="num">0h</span></span>
      </div>
      <div className="log-step-body">
        <p className="log-help">
          These lines flag zero. Log the actual hours anyway — that&apos;s the
          number that shows what the redo really cost you.
        </p>

        {/* Kind */}
        <fieldset className="log-fieldset">
          <legend className="field-label">Whose work</legend>
          <div className="log-opts">
            {COMEBACK_KINDS.map((kind) => {
              const on = comebackKind === kind;
              return (
                <label key={kind} className="log-opt">
                  <input
                    type="radio"
                    name="comeback-kind"
                    value={kind}
                    checked={on}
                    onChange={() => changeComebackKind(kind)}
                  />
                  <span className="log-opt-box">
                    <span className="log-opt-txt">
                      <span className="log-opt-name">{COMEBACK_KIND_LABELS[kind]}</span>
                      <span className="log-opt-note">{KIND_HINTS[kind]}</span>
                    </span>
                    <LogIcon name="check" small className="log-opt-check" />
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Redo-of link — own work only */}
        {comebackKind === "comeback_own" && (
          <div className="log-redo">
            <div className="field-label">Redo of (optional)</div>

            {comebackOfEntryId ? (
              <div className="log-linked">
                <span className="log-linked-txt">
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
                  className="iconbtn"
                  aria-label="Remove link to original RO"
                >
                  <LogIcon name="x" small />
                </button>
              </div>
            ) : (
              <>
                <div className="log-find">
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
                    className="input mono"
                  />
                  <button
                    type="button"
                    onClick={findOriginalRo}
                    disabled={!originalRoSearch.trim() || isFindingOriginal}
                    className="btn btn-line btn-field"
                  >
                    <LogIcon name="search" small />
                    {isFindingOriginal ? "Finding…" : "Find"}
                  </button>
                </div>

                {/* RO numbers get recycled, so a search can legitimately return
                    several unrelated jobs — same reason DuplicateRoDialog
                    exists. Show date + vehicle so they're tellable apart. */}
                {originalRoMatches !== null &&
                  (originalRoMatches.length === 0 ? (
                    <p className="log-help">
                      No RO matching that number. You can still save — the
                      comeback is recorded either way.
                    </p>
                  ) : (
                    <div className="log-matches">
                      {originalRoMatches.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="log-match"
                          onClick={() => chooseOriginalRo(m)}
                        >
                          <span className="log-match-txt">
                            <span className="log-match-date">
                              {formatDateLong(m.date)}
                            </span>
                            {m.vehicleSummary && (
                              <span className="log-match-veh">
                                {m.vehicleSummary}
                              </span>
                            )}
                          </span>
                          <LogIcon name="check" small />
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
