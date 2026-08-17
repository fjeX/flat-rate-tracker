"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { fmtMoney, hasAnyRate, type RateMap } from "@/lib/earnings";
import {
  reconcileEntries,
  unreconciledLines,
  allPayLines,
  shortfallDollars,
  sortUnreconciledLines,
  type PayStatus,
  type ReconcileSort,
} from "@/lib/reconcile";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { buildDisputePack, formatDisputePackText } from "@/lib/dispute-pack";
import { recordExport, useExportedAt } from "@/lib/dispute-exports";
import { setLinePaidHoursAction } from "@/app/actions/entries";

// Resolve a line's display label the same way RoList does — library code,
// custom code, or a library code plus its sub-op-code variant.
function lineLabel(
  line: EntryOpCode,
  libraryById: Map<string, OpCode>,
): string {
  if (line.custom) return (line.customCode ?? "").trim() || "Custom";
  if (line.opCodeId) {
    const oc = libraryById.get(line.opCodeId);
    if (!oc) return "—";
    if (line.subOpCodeId) {
      const sub = oc.subOpCodes.find((s) => s.id === line.subOpCodeId);
      if (sub) return `${oc.code} · ${sub.code}`;
    }
    return oc.code;
  }
  return "—";
}

// How a row's status reads, and whether the row is still asking for work.
// "Done" rows only ever appear with the show-all toggle on, and they are dimmed
// and greyed so a long list can't read as a long to-do list.
const STATUS_PILL: Record<PayStatus, { text: string; className: string }> = {
  pending: { text: "Pending", className: "pill" },
  short: { text: "Short", className: "pill bad" },
  paid: { text: "Paid", className: "pill neutral" },
  over: { text: "Over", className: "pill neutral" },
};

function needsWork(status: PayStatus): boolean {
  return status === "pending" || status === "short";
}

// One editable row: an RO line and the flag hours the shop paid on it. Blur/
// Enter saves; the save pattern mirrors DiscrepancyCard (dirty check, pending,
// error text) and refreshes the server component so a reconciled line drops off
// the working list.
//
// Takes any status, not just pending/short: a paid line whose figure was typed
// wrong has to be correctable somewhere, and this row already is a general
// paid-hours editor. Nothing about it is specific to a line needing work.
function ReconLineRow({
  entry,
  line,
  label,
  status,
}: {
  entry: Entry;
  line: EntryOpCode;
  label: string;
  status: PayStatus;
}) {
  const router = useRouter();
  const initial = line.paidHours ?? null;
  const [paidText, setPaidText] = useState<string>(
    initial === null ? "" : String(initial),
  );
  const [saved, setSaved] = useState<number | null>(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // An EMPTY field means Pending, not "nothing to do". paid_hours is nullable
  // all the way down (setLinePaidHoursSchema is .nullable(), the column is
  // NULL-able) and clearing the box is the only way to put a line that was
  // marked paid by mistake back on the working list. Same shape as the
  // actual-hours editor in RoDetailModal, which has always cleared this way.
  //
  // A negative is NOT the same as empty — it gets its own error and never
  // commits. Letters and malformed decimals never reach here as text: this is
  // type="number", so the UA hands us "" for anything it can't parse, which is
  // indistinguishable from a deliberate clear and lands the line on Pending.
  // That is the recoverable outcome (Pending fabricates no shortfall, unlike a
  // stray 0), so it is tolerated rather than guarded — but do not read the
  // `invalid` branch as covering bad text, because it does not.
  const trimmed = paidText.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  // Null on either side compares correctly here, so clearing an already-empty
  // line is not dirty and fires no write.
  const dirty = !invalid && parsed !== saved;

  function commit() {
    if (invalid) {
      setError("Enter a number, or clear the box to set it back to Pending.");
      return;
    }
    if (!dirty) return;
    setError(null);
    const value = parsed;
    startTransition(async () => {
      try {
        // Validation answers with { error }. It cannot throw it: a thrown Error
        // crossing the Server Actions boundary is redacted to a generic string
        // in production, so "Paid hours can't be more than 999.99." never
        // reached the tech. Only DB failures land in the catch.
        const res = await setLinePaidHoursAction(line.id, value);
        if (res.error) {
          setError(res.error);
          return;
        }
        setSaved(value);
        // The row stays mounted across the refresh (stable key, and with the
        // toggle on it doesn't drop off the list), so the local text has to be
        // re-seeded from what actually landed. Otherwise "1.30" typed over a
        // cleared line, or a blank box over a saved 5.00, sits there stale and
        // the next dirty check compares against the wrong baseline.
        setPaidText(value === null ? "" : String(value));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  const pill = STATUS_PILL[status];
  const done = !needsWork(status);

  return (
    <div
      className={`flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-2 ${
        done ? "bg-[var(--bg-0)] opacity-75" : "bg-[var(--bg-1)]"
      }`}
    >
      <div className="min-w-0 grow">
        <div className="flex items-center gap-2">
          <span className="ro-num">#{entry.roNumber}</span>
          <span className="text-sm font-medium text-[var(--fg-1)] truncate">
            {label}
          </span>
          <span className={pill.className}>{pill.text}</span>
        </div>
        <div className="mt-0.5 text-xs text-[var(--fg-3)]">
          Flag {fmtHours(line.flagHours)}h
        </div>
        {error && <p className="mt-1 text-xs text-[var(--bad)]">{error}</p>}
      </div>
      <label className="shrink-0 text-right">
        <span className="field-label">Paid hrs</span>
        <input
          type="number"
          min={0}
          step={0.1}
          // Convenience only — the server owns the real bound (numeric(5,2)
          // tops out at 999.99). A number input's max does not stop a typed
          // value, so it is a nudge, not a guard.
          max={999.99}
          value={paidText}
          onChange={(e) => setPaidText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          // The placeholder is what an empty box means, spelled out: a blank
          // field is a Pending line, and emptying it puts the line back there.
          placeholder="Pending"
          disabled={isPending}
          aria-label={`Paid flag hours for RO ${entry.roNumber} ${label}`}
          className="input mt-1 w-24 text-right text-base font-semibold"
        />
        {saved !== null && (
          <span className="mt-0.5 block text-[10px] text-[var(--fg-3)]">
            Clear = Pending
          </span>
        )}
      </label>
    </div>
  );
}

export function ReconciliationCard({
  entries,
  library = [],
  rates = {},
  periodKey,
  periodLabel = "",
  techName = null,
  entryIdsWithPhotos,
  embedded = false,
  title = "Pay Reconciliation",
}: {
  entries: Entry[];
  library?: OpCode[];
  rates?: RateMap;
  periodKey?: string;
  periodLabel?: string;
  techName?: string | null;
  entryIdsWithPhotos?: Set<string>;
  // Rendered as a drill-down INSIDE PaidCheckCard rather than as its own card
  // on the page. Drops the card chrome and restyles the toggle as a row; all
  // behaviour below is identical either way.
  embedded?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<ReconcileSort>("ro");
  // Off by default: the working list is pending/short only, and that is the
  // normal workflow. On, the list also shows lines already paid or overpaid, so
  // a figure typed wrong yesterday can be corrected — there is nowhere else in
  // the app to do that.
  const [showAll, setShowAll] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  // Breadcrumb of the last export for this period (localStorage). Null through
  // SSR and hydration, so the "Exported …" hint can't mismatch.
  const exportedAt = useExportedAt(periodKey);

  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const summary = reconcileEntries(entries);
  // `rows` is the working list and the only thing any count, badge or empty
  // state may read. `displayRows` is the list on screen, which the toggle can
  // widen — display only; it never changes what "unreconciled" means.
  const rows = sortUnreconciledLines(unreconciledLines(entries), sort);
  const allRows = sortUnreconciledLines(allPayLines(entries), sort);
  const displayRows = showAll ? allRows : rows;
  const doneCount = allRows.length - rows.length;
  const showMoney = hasAnyRate(rates);
  const dollars = showMoney ? shortfallDollars(entries, rates) : null;

  // Every line still pending (null paid_hours) — the "mark all paid" targets.
  const pendingRows = rows.filter((r) => r.status === "pending");

  // Export surface only appears once there's an actual dispute to raise.
  const canExport = summary.shortLineCount > 0;

  function markExported() {
    if (!periodKey) return;
    // No re-read needed — recordExport notifies the store useExportedAt reads.
    recordExport(periodKey);
  }

  async function copyDisputeText() {
    setCopyError(null);
    const pack = buildDisputePack({
      entries,
      periodLabel,
      library,
      rates,
      techName,
      generatedDate: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      entryIdsWithPhotos,
    });
    try {
      await navigator.clipboard.writeText(formatDisputePackText(pack));
      setCopied(true);
      markExported();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Couldn't copy — long-press to select the text instead.");
    }
  }

  function openPrintView() {
    if (!periodKey) return;
    markExported();
    window.open(
      `/pay-period/dispute-pack?period=${encodeURIComponent(periodKey)}`,
      "_blank",
      "noopener",
    );
  }

  async function markAllPaid() {
    if (pendingRows.length === 0) return;
    // This writes flag hours to every pending line in the period in one click.
    // It used to do that unguarded, and there is no undo — say out loud how
    // many lines and how many hours are about to be claimed as paid. Same
    // window.confirm every other irreversible action in the app uses; it is a
    // real tap target on iOS for free.
    const totalHours = pendingRows.reduce((sum, r) => sum + r.line.flagHours, 0);
    const lineWord = pendingRows.length === 1 ? "line" : "lines";
    if (
      !window.confirm(
        `Mark ${pendingRows.length} ${lineWord} paid at flag hours — ` +
          `${fmtHours(totalHours)}h? This can't be undone in one step.`,
      )
    ) {
      return;
    }
    setMarkError(null);
    setMarkingAll(true);
    // Every line written before it stopped stays written — there is no
    // transaction across these calls — so both the count and the refresh below
    // are how the tech finds out where the loop actually got to.
    let written = 0;
    const stoppedAt = () =>
      ` Stopped after ${written} of ${pendingRows.length} ${
        pendingRows.length === 1 ? "line" : "lines"
      } — the rest are still pending.`;
    try {
      for (const r of pendingRows) {
        const res = await setLinePaidHoursAction(r.line.id, r.line.flagHours);
        if (res.error) {
          // Stop on the first refusal rather than plough on.
          setMarkError(res.error + stoppedAt());
          break;
        }
        written += 1;
      }
    } catch (e) {
      setMarkError(
        (e instanceof Error ? e.message : "Failed to mark all paid.") +
          stoppedAt(),
      );
    } finally {
      // Refresh on EVERY path, thrown ones included. A DB failure mid-loop used
      // to skip this and leave the page showing rows that were already written
      // as if they weren't.
      router.refresh();
      setMarkingAll(false);
    }
  }

  const Root = embedded ? "div" : "section";

  return (
    <Root className={embedded ? "space-y-3" : "card padded-lg space-y-3"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          embedded
            ? "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-2)] px-3 py-2 text-left hover:bg-[var(--bg-3)]"
            : "flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
        }
      >
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="flex items-center gap-2 text-[var(--fg-3)]">
          {!open && summary.shortedHours > 0 && (
            <span className="mono text-sm font-medium tabular-nums text-[var(--bad)]">
              {fmtHours(summary.shortedHours)}h short
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>

      {open && (
      <div className="space-y-3 border-t border-[var(--line)] pt-3">
      {pendingRows.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={markAllPaid}
            disabled={markingAll}
            className="btn btn-sm btn-ghost min-h-11"
          >
            {markingAll ? "Marking…" : "Mark all remaining as paid in full"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="field-label">Shorted hrs</div>
          <div
            className={`mono mt-1 text-base font-semibold tabular-nums ${summary.shortedHours > 0 ? "text-[var(--bad)]" : "text-[var(--fg-1)]"}`}
          >
            {fmtHours(summary.shortedHours)}h
          </div>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="field-label">Pending lines</div>
          <div className="mono mt-1 text-base font-semibold tabular-nums text-[var(--fg-1)]">
            {summary.pendingCount}
          </div>
        </div>
        {dollars !== null && (
          <div className="rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-3 py-2">
            <div className="field-label">Left on the table</div>
            <div
              className={`mono mt-1 text-base font-semibold tabular-nums ${dollars > 0 ? "text-[var(--bad)]" : "text-[var(--fg-1)]"}`}
            >
              {fmtMoney(dollars)}
            </div>
          </div>
        )}
      </div>

      {/* Only worth offering when there is something hidden to reveal. */}
      {doneCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--fg-1)]">
              Show all lines
            </div>
            <div className="text-xs text-[var(--fg-3)]">
              Include the {doneCount} already reconciled{" "}
              {doneCount === 1 ? "line" : "lines"} — to fix a paid figure entered
              wrong.
            </div>
          </div>
          <Switch
            checked={showAll}
            onChange={setShowAll}
            label={
              showAll ? "Hide reconciled lines" : "Show reconciled lines too"
            }
          />
        </div>
      )}

      {/* The banner answers "is there work left?", which is `rows`, never the
          widened list. But with the toggle on it would otherwise sit directly
          above a full list of rows and read as a bug, so it says why they're
          there. */}
      {rows.length === 0 && (
        <p className="rounded-[var(--radius-sm)] bg-[var(--good-bg)] px-3 py-2 text-sm text-[var(--good)]">
          All jobs reconciled for this period.
          {displayRows.length > 0 &&
            " The lines below are already reconciled — edit one to correct it."}
        </p>
      )}

      {displayRows.length > 0 && (
        <div className="space-y-2">
          {/* Ordering matters more here than anywhere else on the page: most
              shops hand out a printed sheet of ROs and flagged lines in RO-number
              order, and working down that sheet against a date-sorted list means
              hunting for every line. RO order is the default for that reason. */}
          <div className="recon-sort">
            <label className="field-label" htmlFor="recon-sort">
              Sort by
            </label>
            <Select
              id="recon-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as ReconcileSort)}
              className="text-sm"
            >
              <option value="ro">RO number — matches your shop&apos;s sheet</option>
              <option value="date">Date — newest first</option>
              <option value="shortfall">Biggest shortfall first</option>
            </Select>
          </div>

          {displayRows.map(({ entry, line, status }) => (
            <ReconLineRow
              key={line.id}
              entry={entry}
              line={line}
              label={lineLabel(line, libraryById)}
              status={status}
            />
          ))}
        </div>
      )}

      {markError && <p className="text-xs text-[var(--bad)]">{markError}</p>}

      {canExport && (
        <div className="border-t border-[var(--line)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-[var(--fg-1)]">
                Export discrepancies
              </div>
              <div className="text-xs text-[var(--fg-3)]">
                Flagged vs. paid variance report for {periodLabel || "this period"}
                {exportedAt && (
                  <>
                    {" · "}
                    <span className="text-[var(--fg-2)]">
                      Exported{" "}
                      {new Date(exportedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyDisputeText}
                className="btn btn-sm btn-ghost min-h-11"
              >
                {copied ? "Copied ✓" : "Copy text"}
              </button>
              {periodKey && (
                <button
                  type="button"
                  onClick={openPrintView}
                  className="btn btn-sm btn-primary min-h-11"
                >
                  Print / PDF
                </button>
              )}
            </div>
          </div>
          {copyError && (
            <p className="mt-1 text-xs text-[var(--bad)]">{copyError}</p>
          )}
        </div>
      )}
      </div>
      )}
    </Root>
  );
}
