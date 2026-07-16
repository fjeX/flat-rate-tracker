"use client";

// Step 2 of the log form: the op-code section — search/picker dropdown, the list
// of added lines with flag/actual hour inputs, quick-add chips, the running
// total, and the three op-code modals (custom line, new library code, sub-op-code
// picker). Presentational — all state and handlers live in useLogRoForm.
import type { Dispatch, RefObject, SetStateAction } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import type { LaborType, OpCode, SubOpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { LABOR_TYPES, LABOR_TYPE_LABELS } from "@/lib/earnings";
import {
  CustomOpCodeModal,
  NewLibraryOpCodeModal,
  type OpCodeDraft,
} from "./OpCodeModals";
import { SubOpCodePickerModal } from "./SubOpCodePickerModal";
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
  laborTypeEnabled,
}: {
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
  // Show the compact per-line labor-type selector. Off unless the user has
  // priced a rate or set a default, so the form is unchanged for everyone else.
  laborTypeEnabled: boolean;
}) {
  return (
    <>
      <div className="step-card active">
        <div className="step-head" style={{ cursor: "default" }}>
          <div className="step-num">2</div>
          <div className="step-title">Op codes</div>
          {lines.length > 0 && (
            <div className="step-summary">
              {lines.length} line{lines.length !== 1 ? "s" : ""} · {fmtHours(totalFlag)}h
            </div>
          )}
        </div>
        <div className="step-body">
          {/* Search / picker */}
          <div className="opc-search" ref={pickerRef}>
            <span className="icon">
              <Search size={15} />
            </span>
            <label htmlFor="opc-search" className="sr-only">Search or add op code</label>
            <input
              id="opc-search"
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              placeholder="Search or add op code…"
              className="input"
              style={{ width: "100%", paddingRight: search ? 36 : undefined }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="opc-clear"
                aria-label="Clear"
              >
                <X size={14} />
              </button>
            )}

            {pickerOpen && (
              <div className="opc-dropdown">
                <div style={{ maxHeight: 256, overflowY: "auto" }}>
                  {filteredLibrary.length === 0 ? (
                    <div className="opc-dropdown-item" style={{ color: "var(--fg-3)", cursor: "default" }}>
                      No matches in your library.
                    </div>
                  ) : (
                    filteredLibrary.map((oc) => (
                      <button
                        key={oc.id}
                        type="button"
                        className="opc-dropdown-item"
                        onClick={() => addFromLibrary(oc)}
                      >
                        <span>
                          <span className="opc-code">{oc.code}</span>
                          <span style={{ marginLeft: 8, fontSize: 12, color: "var(--fg-2)" }}>
                            {oc.description}
                          </span>
                          {oc.subOpCodes.length > 0 && (
                            <span style={{
                              marginLeft: 6,
                              fontSize: 11,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              color: "var(--fg-3)",
                              background: "var(--bg-3)",
                              padding: "1px 5px",
                              borderRadius: 4,
                            }}>
                              {oc.subOpCodes.length} sub{oc.subOpCodes.length !== 1 ? "s" : ""}
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--fg-3)", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                          {oc.subOpCodes.length > 0 ? "select →" : `${oc.flagHours}h`}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="opc-dropdown-footer">
                  <div className="opc-dropdown-footer-label">Other</div>
                  <button
                    type="button"
                    className="opc-dropdown-item"
                    onClick={() => setCustomOpen(true)}
                    style={{ borderRadius: 6 }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Plus size={13} />
                      Other op code (one-time)
                    </span>
                  </button>
                  <button
                    type="button"
                    className="opc-dropdown-item"
                    onClick={() => setNewLibraryOpen(true)}
                    style={{ borderRadius: 6 }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Plus size={13} />
                      Create new library op code
                    </span>
                  </button>
                </div>
                <div style={{ borderTop: "1px solid var(--line)", padding: "6px 12px", textAlign: "right" }}>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(false)}
                    className="opc-dropdown-close"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Op code lines */}
          {lines.length === 0 ? (
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--fg-3)", padding: "16px 0" }}>
              No op codes yet. Search above or tap a chip below.
            </p>
          ) : (
            <div style={{ marginTop: 8 }}>
              {lines.map((line) => {
                const { code, description, subCode } = lineLabel(line, library);
                return (
                  <div key={line.key} className="opc-line">
                    <div className="grow">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span className="opc-code">{code}</span>
                        {subCode && (
                          <span style={{
                            fontSize: 11,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: "var(--brand)",
                            background: "color-mix(in oklab, var(--brand) 15%, transparent)",
                            padding: "1px 5px",
                            borderRadius: 4,
                          }}>
                            {subCode}
                          </span>
                        )}
                        {line.custom && (
                          <span style={{
                            fontSize: 11,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: "var(--fg-3)",
                            background: "var(--bg-3)",
                            padding: "1px 5px",
                            borderRadius: 4,
                          }}>
                            Other
                          </span>
                        )}
                      </div>
                      <div className="opc-desc" style={{ fontSize: 12, color: "var(--fg-2)" }}>
                        {description}
                      </div>
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
                            className="input"
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              padding: "2px 6px",
                              height: "auto",
                              width: "auto",
                              maxWidth: 150,
                            }}
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
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number.isFinite(line.flagHours) ? line.flagHours : ""}
                      onChange={(e) =>
                        updateLine(line.key, {
                          flagHours: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                      className="opc-hours-input"
                      title="Flag hours"
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
                      className="opc-hours-input"
                      title="Actual hours"
                      aria-label={`Actual hours for ${code || "op code line"}`}
                      placeholder="act"
                    />
                    <button
                      type="button"
                      className="remove"
                      onClick={() => removeLine(line.key)}
                      aria-label="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick-add chips */}
          {quickChips.length > 0 && (
            <div className="opc-quick">
              {quickChips.map((oc) => (
                <button
                  key={oc.id}
                  type="button"
                  className="opc-chip"
                  onClick={() => addFromLibrary(oc)}
                >
                  <span className="c">{oc.code}</span>
                  <span className="h">
                    {oc.subOpCodes.length > 0 ? "→" : `${oc.flagHours}h`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Total */}
          {lines.length > 0 && (
            <div className="opc-total">
              <span className="label">Total flag hours</span>
              <span className="val">{fmtHours(totalFlag)}h</span>
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
