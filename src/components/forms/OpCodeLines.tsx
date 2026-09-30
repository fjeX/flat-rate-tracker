"use client";

// Step 2 of the log form: the op-code section — search/picker dropdown, quick
// chips, the list of added lines with flag/actual hour inputs, the running
// total, and the three op-code modals (custom line, new library code, sub-op-code
// picker). Presentational — all state and handlers live in useLogRoForm.
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { LaborType, OpCode, SubOpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { LABOR_TYPES, LABOR_TYPE_LABELS } from "@/lib/earnings";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DurationBar } from "@/components/ui/DurationBar";
import { withPt } from "@/components/ui/Figure";
import {
  CustomOpCodeModal,
  NewLibraryOpCodeModal,
  type OpCodeDraft,
} from "./OpCodeModals";
import { SubOpCodePickerModal } from "./SubOpCodePickerModal";
import { FlaggedTotal, LogIcon, OpCodeChips } from "./logParts";
import type { LineDraft } from "./useLogRoForm";

function lineLabel(
  line: LineDraft,
  library: OpCode[],
): { code: string; description: string; subCode: string | null } {
  if (line.custom) {
    return {
      code: line.customCode ?? "",
      description: line.customDescription ?? "",
      subCode: null,
    };
  }
  const ref = library.find((oc) => oc.id === line.opCodeId);
  if (line.subOpCodeId && ref) {
    const sub = ref.subOpCodes.find((s) => s.id === line.subOpCodeId);
    if (sub) {
      return { code: ref.code, description: sub.description, subCode: sub.code };
    }
  }
  return {
    code: ref?.code ?? "",
    description: ref?.description ?? "",
    subCode: null,
  };
}

export function OpCodeLines({
  step,
  library,
  lines,
  search,
  setSearch,
  pickerOpen,
  setPickerOpen,
  pickerRef,
  filteredLibrary,
  totalFlag,
  quickChips,
  customOpen,
  setCustomOpen,
  newLibraryOpen,
  setNewLibraryOpen,
  newLibraryPending,
  subPickerOc,
  setSubPickerOc,
  addFromLibrary,
  confirmSubPick,
  addCustomLine,
  addNewLibraryLine,
  updateLine,
  removeLine,
  toggleLineComeback,
  laborTypeEnabled,
}: {
  /** Position of this step in the form, counted by LogRoForm — the op-code
   *  step is skipped entirely in ticket mode, so the badge cannot be a literal. */
  step: number;
  library: OpCode[];
  lines: LineDraft[];
  search: string;
  setSearch: (v: string) => void;
  pickerOpen: boolean;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  pickerRef: RefObject<HTMLDivElement | null>;
  filteredLibrary: OpCode[];
  totalFlag: number;
  quickChips: OpCode[];
  customOpen: boolean;
  setCustomOpen: (v: boolean) => void;
  newLibraryOpen: boolean;
  setNewLibraryOpen: (v: boolean) => void;
  newLibraryPending: boolean;
  subPickerOc: OpCode | null;
  setSubPickerOc: (v: OpCode | null) => void;
  addFromLibrary: (oc: OpCode) => void;
  confirmSubPick: (sub: SubOpCode) => void;
  addCustomLine: (draft: OpCodeDraft) => void;
  addNewLibraryLine: (draft: OpCodeDraft) => Promise<void>;
  updateLine: (key: string, patch: Partial<LineDraft>) => void;
  removeLine: (key: string) => void;
  toggleLineComeback: (key: string, on: boolean) => void;
  // Show the compact per-line labor-type selector. Off unless the user has
  // priced a rate or set a default, so the form is unchanged for everyone else.
  laborTypeEnabled: boolean;
}) {
  const comebackLines = lines.filter((l) => l.isComeback);
  const comebackLineCount = comebackLines.length;
  // Actual hours, not flag — flag is zero by construction. This is the number
  // that answers "how much of my day did the redo eat".
  const comebackActualHours = comebackLines.reduce(
    (s, l) => s + (l.actualHours ?? 0),
    0,
  );

  return (
    <>
      <div className="log-step">
        <div className="log-step-head">
          <span className="log-step-no">{step}</span>
          <h3 className="log-step-title">Add the op codes</h3>
          {lines.length > 0 && (
            <span className="log-step-aside">
              {lines.length} line{lines.length !== 1 ? "s" : ""} ·{" "}
              <span className="num">{withPt(`${fmtHours(totalFlag)}h`)}</span>
            </span>
          )}
        </div>
        <div className="log-step-body">
          {/* Search / picker */}
          <div className="log-search" ref={pickerRef}>
            <LogIcon name="search" className="log-search-ic" />
            <label htmlFor="opc-search" className="sr-only">Search or add op code</label>
            <input
              id="opc-search"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              placeholder="Search or add op code…"
              autoComplete="off"
              className="input"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="iconbtn log-search-clear"
                aria-label="Clear"
              >
                <LogIcon name="x" small />
              </button>
            )}

            {pickerOpen && (
              <div className="opc-dropdown log-dd">
                <div className="log-dd-list">
                  {filteredLibrary.length === 0 ? (
                    <div className="log-dd-empty">No matches in your library.</div>
                  ) : (
                    filteredLibrary.map((oc) => (
                      <button
                        key={oc.id}
                        type="button"
                        className="opc-dropdown-item log-dd-item"
                        onClick={() => addFromLibrary(oc)}
                      >
                        <span className="log-dd-main">
                          <b className="log-code">{oc.code}</b>
                          <span className="log-dd-desc">{oc.description}</span>
                          {oc.subOpCodes.length > 0 && (
                            <Badge chip>
                              {oc.subOpCodes.length} sub{oc.subOpCodes.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                        </span>
                        <span className="log-dd-hrs num">
                          {oc.subOpCodes.length > 0 ? "select →" : `${fmtHours(oc.flagHours)}h`}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="log-dd-foot">
                  <div className="log-dd-label">Other</div>
                  <button
                    type="button"
                    className="opc-dropdown-item log-dd-item"
                    onClick={() => setCustomOpen(true)}
                  >
                    <span className="log-dd-main">
                      <LogIcon name="plus" small />
                      Other op code (one-time)
                    </span>
                  </button>
                  <button
                    type="button"
                    className="opc-dropdown-item log-dd-item"
                    onClick={() => setNewLibraryOpen(true)}
                  >
                    <span className="log-dd-main">
                      <LogIcon name="plus" small />
                      Create new library op code
                    </span>
                  </button>
                  <div className="log-dd-close">
                    <button
                      type="button"
                      onClick={() => setPickerOpen(false)}
                      className="btn btn-quiet btn-sm"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick-add chips */}
          <OpCodeChips chips={quickChips} lines={lines} onAdd={addFromLibrary} onRemoveLine={removeLine} />

          {/* Op code lines */}
          {lines.length === 0 ? (
            <p className="log-lines-empty">No op codes yet. Search above or tap a chip.</p>
          ) : (
            <div className="log-lines">
              <div className="log-lines-head" aria-hidden="true">
                <span>Code</span>
                <span className="r">Flag</span>
                <span className="r">Actual</span>
                <span />
              </div>
              <ul>
                {lines.map((line) => {
                  const { code, description, subCode } = lineLabel(line, library);
                  return (
                    <li key={line.key} className="log-line">
                      <div className="log-line-code">
                        <b className="log-code">{code}</b>
                        {subCode && (
                          <Badge chip mono>
                            {subCode}
                          </Badge>
                        )}
                        {line.custom && <Badge chip>Other</Badge>}
                      </div>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={
                          line.isComeback
                            ? 0
                            : Number.isFinite(line.flagHours)
                              ? line.flagHours
                              : ""
                        }
                        onChange={(e) =>
                          updateLine(line.key, {
                            flagHours: e.target.value === "" ? 0 : Number(e.target.value),
                          })
                        }
                        // Locked, not just zeroed. A comeback flags nothing by
                        // definition; leaving the field editable invites someone
                        // to "correct" it back to the book time, which is the
                        // exact wrong number.
                        disabled={line.isComeback}
                        className="input mono log-hrs"
                        title={
                          line.isComeback
                            ? "Comebacks flag zero hours"
                            : "Flag hours"
                        }
                        aria-label={`Flag hours for ${code || "op code line"}`}
                        placeholder="flag"
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={line.actualHours ?? ""}
                        onChange={(e) =>
                          updateLine(line.key, {
                            actualHours: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className="input mono log-hrs"
                        title="Actual hours"
                        aria-label={`Actual hours for ${code || "op code line"}`}
                        placeholder="act"
                      />
                      <button
                        type="button"
                        className="iconbtn"
                        onClick={() => removeLine(line.key)}
                        // Named like the two hours inputs beside it. This is the
                        // only control in the row that used to announce the same
                        // string on every line, so it was the only one a script
                        // had to pick positionally — the 2026-08-19 failure mode.
                        aria-label={code ? `Remove line ${code}` : "Remove line"}
                      >
                        <LogIcon name="x" small />
                      </button>
                      {description && <div className="log-line-desc">{description}</div>}
                      <div className="log-line-dur">
                        <DurationBar hours={line.isComeback ? 0 : line.flagHours} />
                      </div>
                      <div className="log-line-opts">
                        {laborTypeEnabled && (
                          <>
                            <label htmlFor={`labor-type-${line.key}`} className="sr-only">
                              Labor type for {code || "op code line"}
                            </label>
                            {/* Legacy null lines predate labor types and are priced
                                as Customer Pay (earnings.ts), so they must DISPLAY as
                                Customer Pay — otherwise a line reads "Untyped" while
                                still earning money. Only an explicit "untyped"
                                selection is deliberately unpriced. */}
                            <select
                              id={`labor-type-${line.key}`}
                              value={line.laborType ?? "customer_pay"}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  laborType: e.target.value as LaborType | "untyped",
                                })
                              }
                              className="input log-labor"
                            >
                              <option value="untyped">Untyped</option>
                              {LABOR_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {LABOR_TYPE_LABELS[t]}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                        {/* Comeback toggle. Per-LINE because a comeback is often
                            extra lines appended to the original ticket, not a
                            whole new RO — marking the entry would overstate it. */}
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => toggleLineComeback(line.key, !line.isComeback)}
                          aria-pressed={line.isComeback ?? false}
                          className="log-toggle"
                        >
                          {line.isComeback ? "Comeback — unpaid" : "Mark as comeback"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Total */}
          {/* Always drawn, "0.0h" included (mock lines-total): the headline row is
              part of the list, not a reward for adding a line. */}
          <FlaggedTotal hours={totalFlag} />

          {/* Unpaid rework sits BESIDE the flag total, never subtracted from it
              — the whole point is to make free work visible without quietly
              rewriting the efficiency number it sits next to. */}
          {comebackLineCount > 0 && (
            <div className="log-foot-row">
              <span className="log-foot-k">
                Unpaid rework · {comebackLineCount} line
                {comebackLineCount !== 1 ? "s" : ""}
              </span>
              <span className="num">
                {comebackActualHours > 0
                  ? withPt(`${fmtHours(comebackActualHours)}h`)
                  : "— add actual hrs"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---- Modals ---- */}
      <CustomOpCodeModal
        open={customOpen}
        initialCode={search}
        onAdd={addCustomLine}
        onClose={() => setCustomOpen(false)}
      />
      <NewLibraryOpCodeModal
        open={newLibraryOpen}
        initialCode={search}
        onSubmit={addNewLibraryLine}
        onClose={() => setNewLibraryOpen(false)}
        isPending={newLibraryPending}
      />
      {subPickerOc && (
        <SubOpCodePickerModal
          opCode={subPickerOc}
          onSelect={confirmSubPick}
          onClose={() => setSubPickerOc(null)}
        />
      )}
    </>
  );
}
