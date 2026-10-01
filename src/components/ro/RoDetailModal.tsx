"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StatusField } from "@/components/ui/StatusField";
import { EntryPhotos } from "@/components/ro/EntryPhotos";
import { TicketTimeline } from "@/components/ro/TicketTimeline";
import { LinkedSpiffs } from "@/components/bonuses/LinkedSpiffs";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { formatDateLong, formatLoggedTime } from "@/lib/periods";
import { fmtHours } from "@/lib/stats";
import { entryEarnings, fmtMoney, hasAnyRate, lineEarnings, type RateMap } from "@/lib/earnings";
import {
  addOpCodeLineToEntryAction,
  deleteEntryAction,
  deleteEntryLineAction,
  setLineActualHoursAction,
  setLineUpsellAction,
} from "@/app/actions/entries";
import { actionErrorMessage } from "@/lib/action-error";

export function RoDetailModal({
  entry,
  library = [],
  rates = {},
  onClose,
  onDeleted,
  autoOpenAddLine = false,
}: {
  entry: Entry;
  library?: OpCode[];
  rates?: RateMap;
  onClose: () => void;
  /**
   * Open with the op-code picker already up and the new line pre-marked as an
   * upsell. Set by the dashboard's Upsell shortcut, which exists to remove the
   * two taps between "the customer said yes" and "the line is on the RO".
   */
  autoOpenAddLine?: boolean;
  // Called after the whole RO is deleted. When provided, the parent owns the
  // post-delete refresh (e.g. History prunes its paginated "Load more" state,
  // which a bare router.refresh() can't reach). Falls back to router.refresh().
  onDeleted?: (entryId: string) => void;
}) {
  const router = useRouter();
  const libraryById = useMemo(() => new Map(library.map((oc) => [oc.id, oc])), [library]);
  // Op codes that appear on MORE THAN ONE line of this RO. A line's op code is
  // not an identifier — two ALIGN lines on one ticket is ordinary — so any
  // control named after the code alone would announce twice, identically. Only
  // these codes need a position to break the tie; see LineRow.
  const duplicateCodes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of entry.opCodes) {
      const c = displayCode(line, libraryById);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([c]) => c),
    );
  }, [entry.opCodes, libraryById]);
  const totalActual = entry.opCodes.reduce(
    (s, oc) => s + (oc.actualHours ?? 0),
    0,
  );
  const hasAnyActual = entry.opCodes.some((oc) => oc.actualHours !== null);
  const comebackLines = entry.opCodes.filter((oc) => oc.isComeback);
  const comebackLineCount = comebackLines.length;
  // Actual hours, not flag — flag is zero on these by construction.
  const comebackActual = comebackLines.reduce((s, oc) => s + (oc.actualHours ?? 0), 0);
  // Dollars only surface once the user has priced at least one rate.
  const showMoney = hasAnyRate(rates);
  const roEarnings = showMoney ? entryEarnings(entry, rates) : 0;
  // An open ticket has no lines YET (Open Tickets, decision 1). The lines
  // block, the add-line picker and the earnings row describe the flag, which
  // lands at close — so on an open ticket the Timeline section stands where
  // they would, and the close flow is where the codes get entered.
  const isOpen = entry.status === "open";
  // Phase 2: a REOPENED ticket (decision 11) is `status === "open"` again but
  // can already carry lines from its first close. Gating the lines block on
  // isOpen alone would hide a real, flagged line list the moment it reopens —
  // so the gate is "has no lines yet", not "is open".
  const hasLines = entry.opCodes.length > 0;
  // Guest entries are in-memory and the timeline actions cannot resolve them.
  // A guest RO never carries a status (decision 12 — the guest store builds
  // its entries client-side without one), so the status IS the guest gate:
  // the section mounts only for a row the database mapper produced.
  const hasTimeline = entry.status !== undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={`RO #${entry.roNumber}`}
      size="lg"
      footer={<Footer entry={entry} onClose={onClose} onDeleted={onDeleted} />}
    >
      <div className="rod-body">
        {isOpen && (
          <div className="rod-open">
            <Badge tone="info">Open ticket</Badge>
            <span className="rod-fine">
              {hasLines
                ? "Reopened — close it again to add or edit lines."
                : "No op codes yet — flag lands when you close it."}
            </span>
          </div>
        )}
        <div className="rod-meta">
          {/* The time the tech recorded for the WORK sits on the date line,
              because it is part of that date. The "Logged" line below is a
              different fact — when the row was written — and they are kept
              visually apart so a 9pm batch entry can't be read as a 9pm job. */}
          <div className="rod-date">
            {formatDateLong(entry.date)}
            {formatLoggedTime(entry.loggedTime) &&
              ` · ${formatLoggedTime(entry.loggedTime)}`}
          </div>
          <div className="rod-logged">
            Logged{" "}
            {new Date(entry.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </div>
          <VehicleLine
            year={entry.vehicle.year}
            make={entry.vehicle.make}
            model={entry.vehicle.model}
            vin={entry.vehicle.vin}
            mileage={entry.vehicle.mileage}
          />
        </div>

        {hasLines && (
          <div className="rod-lines">
            {/* Header, rows and totals are one table, so Flag / Actual line up
                with the inputs without a hand-kept grid template. */}
            <table className="table rod-table">
              <thead>
                <tr>
                  <th scope="col">Op code</th>
                  <th scope="col" className="table-num rod-col-flag">Flag</th>
                  <th scope="col" className="table-num rod-col-act">Actual</th>
                  <th scope="col" className="rod-col-rm" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {/* The index here IS the on-screen order — this map is the only
                    thing that renders the list — so a "line N" in an accessible
                    name is a number a sighted user can count down to. */}
                {entry.opCodes.map((line, i) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    libraryById={libraryById}
                    lineNumber={i + 1}
                    duplicateCodes={duplicateCodes}
                    isOnly={entry.opCodes.length === 1}
                    onDeleted={() => router.refresh()}
                    earnings={showMoney ? lineEarnings(line, rates) : null}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="table-foot">
                  <td>Flagged total</td>
                  <td className="table-num">{fmtHours(entry.flagHours)}h</td>
                  <td className="table-num">
                    {hasAnyActual ? `${fmtHours(totalActual)}h` : "—"}
                  </td>
                  <td />
                </tr>
                {/* Why the flag total is lower than the work looks. Without this, a
                    mixed RO just reads as a smaller number with no explanation —
                    which is the same confusion the per-line badge fixes, one level
                    up. Reported beside the total, never subtracted from it. */}
                {comebackLineCount > 0 && (
                  <tr className="rod-sub">
                    <td colSpan={2}>
                      Unpaid rework · {comebackLineCount} line
                      {comebackLineCount !== 1 ? "s" : ""}
                    </td>
                    <td className="table-num">
                      {comebackActual > 0 ? `${fmtHours(comebackActual)}h` : "—"}
                    </td>
                    <td />
                  </tr>
                )}
                {showMoney && (
                  <tr className="rod-sub">
                    <td>Earnings</td>
                    <td colSpan={3} className="table-num rod-good">{fmtMoney(roEarnings)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}

        {/* Quick-add op code from library. Not on an open ticket: its lines
            arrive through the close flow, which is where the "at least one
            op code" rule is enforced for a ticket. */}
        {!isOpen && (
          <AddOpCodePicker
            entryId={entry.id}
            library={library}
            autoOpen={autoOpenAddLine}
            defaultUpsell={autoOpenAddLine}
            onAdded={() => router.refresh()}
          />
        )}

        {/* The ticket's story and per-day hours. Renders nothing on an ordinary
            RO with no timeline; always renders on an open ticket. */}
        {hasTimeline && (
          <TicketTimeline entry={entry} onChanged={() => router.refresh()} />
        )}

        {entry.notes && (
          <div className="card-inset rod-well">
            <h3 className="field-label">Notes</h3>
            <p className="rod-notes-text">{entry.notes}</p>
          </div>
        )}

        {/* Photo evidence — thumbnails, attach, full-screen viewer. */}
        <EntryPhotos entryId={entry.id} />

        {/* Spiffs/bonuses attached to this RO (read-only). */}
        <LinkedSpiffs entryId={entry.id} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------

const DESC_CHAR_LIMIT = 80;

function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= DESC_CHAR_LIMIT) {
    return <div className="rod-desc">{text}</div>;
  }
  return (
    <div className="rod-desc">
      {expanded ? text : text.slice(0, DESC_CHAR_LIMIT) + "…"}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        aria-expanded={expanded}
        className="rod-more"
      >
        {expanded ? "less" : "more"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------

function VehicleLine({
  year,
  make,
  model,
  vin,
  mileage,
}: {
  year: string;
  make: string;
  model: string;
  vin: string;
  mileage: string;
}) {
  const label = [year, make, model].filter(Boolean).join(" ").trim();
  if (!label && !vin && !mileage) return null;
  return (
    <div className="rod-veh">
      {label && <div className="rod-veh-name">{label}</div>}
      {vin && (
        <div className="rod-veh-line">
          VIN: <span className="num">{vin}</span>
        </div>
      )}
      {mileage && (
        <div className="rod-veh-line">
          Mileage: <span className="num">{mileage}</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

// The em dash the UI shows when a line has no usable code. It names nothing, so
// every accessible name treats it as "no code at all".
const NO_CODE = "—";

/**
 * The op code string a line displays. Shared by the modal (to find codes used
 * by more than one line) and by LineRow (to render it), so the two can never
 * disagree about what a row is called.
 */
function displayCode(line: EntryOpCode, libraryById: Map<string, OpCode>): string {
  if (line.custom) return (line.customCode ?? "").trim() || NO_CODE;
  const ref = line.opCodeId ? libraryById.get(line.opCodeId) : undefined;
  return ref?.code ?? NO_CODE;
}

function LineRow({
  line,
  libraryById,
  lineNumber,
  duplicateCodes,
  isOnly,
  onDeleted,
  earnings,
}: {
  line: EntryOpCode;
  libraryById: Map<string, OpCode>;
  /** 1-based position in the rendered list, used only to break name ties. */
  lineNumber: number;
  /** Codes this RO shows on more than one line. */
  duplicateCodes: Set<string>;
  isOnly: boolean;
  onDeleted: () => void;
  earnings: number | null; // null when rates are off or this line's type is unpriced
}) {
  const router = useRouter();
  const [text, setText] = useState<string>(
    line.actualHours !== null ? String(line.actualHours) : "",
  );
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [markingUpsell, startUpsell] = useTransition();
  const [upsell, setUpsell] = useState(line.isUpsell ?? false);
  const [error, setError] = useState<string | null>(null);

  // Marking works both ways and on any line, not only ones added through the
  // Upsell shortcut. Most upsells get written down with the rest of the RO at
  // the end of the job, and a flag that can only be set at insert time would
  // miss those — leaving the "hours you sold" figure quietly short.
  function toggleUpsell() {
    const next = !upsell;
    setError(null);
    setUpsell(next); // optimistic; reverted below if the server refuses
    startUpsell(async () => {
      try {
        await setLineUpsellAction(line.id, next);
        router.refresh();
      } catch (e) {
        setUpsell(!next);
        setError(actionErrorMessage(e, "Couldn't save that."));
      }
    });
  }

  const ref = line.opCodeId ? libraryById.get(line.opCodeId) : undefined;
  const code = displayCode(line, libraryById);

  // ---- Accessible names for this row's controls ------------------------
  //
  // This row has no aria-labelledby relationship to anything, so the upsell
  // toggle, the actual-hours input and the trash button each have to name
  // themselves. `code` is the OP CODE — every line using it shows the same
  // string — so it is not on its own an identifier: an RO with two ALIGN
  // lines used to render two byte-identical names, which is precisely the
  // collision this is here to prevent. `line.id` is a UUID and is useless to
  // read aloud, so the tiebreaker is the row's 1-based position.
  //
  // Qualified only when the code is ACTUALLY duplicated on this RO, not
  // always. Always numbering would put "line 1" into every name on the
  // overwhelmingly common single-line RO, where there is no ambiguity to
  // resolve and the number is pure noise; a name only needs to be unique
  // among the names present. The cost is that adding a second ALIGN line
  // renames the first ALIGN control — but the un-qualified name is wrong the
  // instant that second line exists, so that rename is the fix landing, and
  // it lands during the full re-render the router.refresh() already causes.
  const hasCode = code !== NO_CODE;
  const needsPosition = duplicateCodes.has(code);
  // "ALIGN" | "ALIGN on line 2" | "line 2" | null (nothing distinguishes it,
  // because nothing needs to).
  const lineName = hasCode
    ? needsPosition
      ? `${code} on line ${lineNumber}`
      : code
    : needsPosition
      ? `line ${lineNumber}`
      : null;
  // "line ALIGN" | "line 2, ALIGN" | "line 2" | "line"
  const removeTarget = hasCode
    ? needsPosition
      ? `line ${lineNumber}, ${code}`
      : `line ${code}`
    : needsPosition
      ? `line ${lineNumber}`
      : "line";

  const subRef = line.subOpCodeId && ref
    ? ref.subOpCodes.find((s) => s.id === line.subOpCodeId)
    : undefined;
  const description = line.custom
    ? (line.customDescription ?? "").trim()
    : subRef
      ? subRef.description
      : (ref?.description ?? "");

  function commit() {
    const trimmed = text.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Invalid");
      return;
    }
    if (parsed === line.actualHours) return;
    setError(null);
    startSave(async () => {
      try {
        // Validation answers with { error } — a thrown one would be redacted in
        // production. Only DB failures reach the catch.
        const res = await setLineActualHoursAction(line.id, parsed);
        if (res.error) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(actionErrorMessage(e, "Failed"));
      }
    });
  }

  function handleDelete() {
    if (isOnly) {
      alert("An RO needs at least one line.");
      return;
    }
    if (!window.confirm("Remove this line?")) return;
    setError(null);
    startDelete(async () => {
      try {
        await deleteEntryLineAction(line.id);
        onDeleted();
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to remove."));
      }
    });
  }

  return (
    <tr>
      <td>
        <div className="rod-code">
          <Badge chip mono className="rod-code-main">{code}</Badge>
          {subRef && (
            <Badge tone="brand" mono>
              {subRef.code}
            </Badge>
          )}
          {line.custom && <Badge>Other</Badge>}
          {line.isComeback && (
            <Badge tone="warn">
              Comeback
            </Badge>
          )}
          {/* A toggle, not a label — and deliberately visible even when off, or
              there would be no way to mark a line the log form already saved.
              Hidden entirely on a comeback: the DB refuses that combination, so
              offering the control would be offering an error. */}
          {!line.isComeback && (
            <button
              type="button"
              onClick={toggleUpsell}
              disabled={markingUpsell}
              aria-pressed={upsell}
              // Named like the Remove-line button beside it: every line's
              // upsell toggle announced the identical string "Upsell". See the
              // lineName block above for how a row identifies itself.
              aria-label={
                lineName
                  ? upsell
                    ? `Unmark ${lineName} as upsell`
                    : `Mark ${lineName} as upsell`
                  : upsell
                    ? "Unmark as upsell"
                    : "Mark as upsell"
              }
              title={
                upsell
                  ? "Marked as an upsell — tap to unmark"
                  : "Mark this line as an upsell"
              }
              className="fchip rod-up"
            >
              Upsell
            </button>
          )}
        </div>
        {description && <ExpandableDescription text={description} />}
        {/* A comeback line reads 0.0h and, with rates on, "$0.00" in the
            same green used for real money — which looks like a mistake or a
            bug rather than the point. Say what it is instead: the zero is
            deliberate, and the hours the tech actually spent are in the
            actual-hours box to the right. */}
        {line.isComeback ? (
          <div className="rod-rework">
            Unpaid rework — flags no hours
          </div>
        ) : (
          earnings !== null && (
            <div className="rod-earn">
              {fmtMoney(earnings)}
            </div>
          )
        )}
        {error && (
          <StatusField tag="Fix" role="alert" inset id={`line-error-${line.id}`}>
            <p>{error}</p>
          </StatusField>
        )}
        {line.notes && (
          <p className="rod-line-note">{line.notes}</p>
        )}
      </td>
      <td className="table-num rod-col-flag">
        {fmtHours(line.flagHours)}
      </td>
      <td className="rod-col-act rod-cell-in">
        <input
          type="number"
          min={0}
          step={0.1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="—"
          disabled={saving || deleting}
          // Same collision as the two buttons — and the old string put the
          // bare em dash into the name ("Actual hours for —") on a codeless
          // line, which announces as nothing useful.
          aria-label={lineName ? `Actual hours for ${lineName}` : "Actual hours"}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `line-error-${line.id}` : undefined}
          className="input num opc-hours-input rod-hours"
        />
      </td>
      <td className="rod-col-rm">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || isOnly}
          // Named like the actual-hours input beside it. Every line's trash can
          // announced the identical string, so the only way to target one was
          // by position — which is exactly how the wrong row got deleted on
          // 2026-08-19. Naming it after the op code alone did NOT fix that:
          // two lines sharing a code still announced identically.
          aria-label={`Remove ${removeTarget}`}
          className="rod-x"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ------------------------------------------------------------------------

function AddOpCodePicker({
  entryId,
  library,
  onAdded,
  autoOpen = false,
  defaultUpsell = false,
}: {
  entryId: string;
  library: OpCode[];
  onAdded: () => void;
  autoOpen?: boolean;
  defaultUpsell?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(autoOpen);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subPickOc, setSubPickOc] = useState<OpCode | null>(null);
  // Pre-checked when the shortcut opened this, and clearable in one tap.
  //
  // Not every line added after the fact is a sale — sometimes you just forgot
  // one — so the flag is shown rather than applied silently. A button labelled
  // "Upsell" that quietly marks whatever you pick would put work you never sold
  // into the figure the whole feature exists to produce.
  const [markUpsell, setMarkUpsell] = useState(defaultUpsell);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return library;
    return library.filter(
      (oc) =>
        oc.code.toLowerCase().includes(q) ||
        oc.description.toLowerCase().includes(q),
    );
  }, [search, library]);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  function addLine(oc: OpCode, subOpCodeId?: string) {
    setError(null);
    const flagHours = subOpCodeId
      ? (oc.subOpCodes.find((s) => s.id === subOpCodeId)?.flagHours ?? oc.flagHours)
      : oc.flagHours;
    startTransition(async () => {
      try {
        await addOpCodeLineToEntryAction(entryId, {
          opCodeId: oc.id,
          custom: false,
          customCode: null,
          customDescription: null,
          flagHours,
          actualHours: null,
          notes: "",
          subOpCodeId: subOpCodeId ?? null,
          laborType: null,
          isUpsell: markUpsell,
        });
        onAdded();
        setSearch("");
        setOpen(false);
        setSubPickOc(null);
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to add."));
      }
    });
  }

  function handleOpCodeClick(oc: OpCode) {
    if (oc.subOpCodes.length > 0) {
      setSubPickOc(oc);
    } else {
      addLine(oc);
    }
  }

  if (!library.length) return null;

  return (
    <div ref={containerRef} className="rod-add">
      {/* Above the picker, not below it: the tech reads this BEFORE choosing a
          code, and a checkbox found after the list has already been tapped is a
          checkbox that never gets read. Rendered for both steps, since a code
          with variants adds its line from the sub-picker. */}
      {open && (
        <label className="rod-check">
          <input
            type="checkbox"
            checked={markUpsell}
            onChange={(e) => setMarkUpsell(e.target.checked)}
          />
          Mark as an upsell — work you sold, not what they came in for
        </label>
      )}
      {!open ? (
        <Button block onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add op code
        </Button>
      ) : subPickOc ? (
        // Sub op code selection step
        <div className="card-inset rod-pick-well">
          <div className="rod-pick-head">
            <Button variant="quiet" size="sm" onClick={() => setSubPickOc(null)}>
              ← Back
            </Button>
            <span>
              Sub op code for{" "}
              <span className="rod-code-main">{subPickOc.code}</span>
            </span>
          </div>
          <div className="log-picks rod-picks">
            {subPickOc.subOpCodes.map((sub) => (
              <button
                key={sub.id}
                type="button"
                disabled={pending}
                onClick={() => addLine(subPickOc, sub.id)}
                className="log-pick"
              >
                <span className="log-pick-txt">
                  <b>{sub.code}</b>
                  {sub.description && (
                    <span className="log-pick-desc">{sub.description}</span>
                  )}
                </span>
                <span className="log-pick-act num">{fmtHours(sub.flagHours)}h</span>
              </button>
            ))}
          </div>
          {error && (
            <StatusField tag="Fix" role="alert" inset>
              <p>{error}</p>
            </StatusField>
          )}
        </div>
      ) : (
        <div className="card-inset rod-pick-well">
          <div className="search-well">
            <Search aria-hidden="true" />
            <label htmlFor="ro-detail-add-search" className="sr-only">Search op codes</label>
            <input
              id="ro-detail-add-search"
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search op codes…"
              className="input"
            />
            <button
              type="button"
              onClick={() => { setOpen(false); setSearch(""); }}
              aria-label="Close op code search"
              className="search-clear"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="log-picks rod-picks">
            {filtered.length === 0 ? (
              <p className="rod-none">No matches.</p>
            ) : (
              filtered.map((oc) => (
                <button
                  key={oc.id}
                  type="button"
                  disabled={pending}
                  onClick={() => handleOpCodeClick(oc)}
                  className="log-pick"
                >
                  <span className="log-pick-txt">
                    <b>{oc.code}</b>
                    <span className="log-pick-desc">{oc.description}</span>
                  </span>
                  <span className="log-pick-act num">
                    {oc.subOpCodes.length > 0 ? "select →" : `${fmtHours(oc.flagHours)}h`}
                  </span>
                </button>
              ))
            )}
          </div>
          {error && (
            <StatusField tag="Fix" role="alert" inset>
              <p>{error}</p>
            </StatusField>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

function Footer({
  entry,
  onClose,
  onDeleted,
}: {
  entry: Entry;
  onClose: () => void;
  onDeleted?: (entryId: string) => void;
}) {
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    // Name the RO. This is the most expensive delete in the app — the lines
    // going away are flag hours, which move pay and efficiency — and "Delete
    // this RO?" describes every RO equally, so it can't catch a click on the
    // wrong row (or an automated one, as on 2026-08-19).
    //
    // The date is in here on purpose: the shop recycles 5-digit RO numbers, so
    // the number alone does not identify a ticket.
    const ro = entry.roNumber?.trim();
    const vehicle = [entry.vehicle.year, entry.vehicle.make, entry.vehicle.model]
      .filter(Boolean)
      .join(" ")
      .trim();
    const bits = [
      vehicle || null,
      Number.isFinite(entry.flagHours) ? `${fmtHours(entry.flagHours)}h flagged` : null,
      // formatDateLong assumes "YYYY-MM-DD"; drop the clause rather than print
      // "undefined undefined, NaN".
      /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? formatDateLong(entry.date) : null,
    ].filter(Boolean);
    const head = ro ? `RO #${ro}` : "this RO";
    const what = bits.length > 0 ? `${head} — ${bits.join(", ")}` : head;
    if (!window.confirm(`Delete ${what}? This can't be undone.`)) return;
    setError(null);
    startDelete(async () => {
      try {
        await deleteEntryAction(entry.id);
        onClose();
        // Let the parent reconcile its own list state if it wants to; otherwise
        // fall back to a plain server refresh.
        if (onDeleted) onDeleted(entry.id);
        else router.refresh();
      } catch (e) {
        setError(actionErrorMessage(e, "Failed to delete."));
      }
    });
  }

  return (
    <div className="rod-foot">
      {error && (
        <StatusField tag="Fix" role="alert" inset className="rod-foot-err">
          <p>{error}</p>
        </StatusField>
      )}
      <Button variant="danger" onClick={handleDelete} disabled={deleting}>
        <Trash2 className="h-4 w-4" />
        {deleting ? "Deleting…" : "Delete"}
      </Button>
      <div className="rod-foot-right">
        <Button variant="quiet" onClick={onClose}>Close</Button>
        {/* On an open ticket "Edit" edits the progressive fields (vehicle,
            notes) and the close flow is the primary action; the timeline
            section above carries the Close button too, next to the hours
            it is closing. */}
        <Link
          href={`/log?edit=${entry.id}`}
          className={entry.status === "open" ? "btn" : "btn btn-go"}
        >
          <Pencil className="h-4 w-4" />
          {entry.status === "open" ? "Edit ticket" : "Edit RO"}
        </Link>
        {entry.status === "open" && (
          <Link
            href={`/log?edit=${entry.id}&close=1`}
            className="btn btn-go"
          >
            Close ticket
          </Link>
        )}
      </div>
    </div>
  );
}
