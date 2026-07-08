"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { fmtHours } from "@/lib/stats";
import { fmtMoney, hasAnyRate, type RateMap } from "@/lib/earnings";
import {
  reconcileEntries,
  unreconciledLines,
  shortfallDollars,
} from "@/lib/reconcile";
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

function parseHours(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// One editable row: an RO line that's pending or short. Blur/Enter saves the
// paid hours; the save pattern mirrors DiscrepancyCard (dirty check, pending,
// error text) and refreshes the server component so a reconciled line drops off.
function ReconLineRow({
  entry,
  line,
  label,
  status,
}: {
  entry: Entry;
  line: EntryOpCode;
  label: string;
  status: "pending" | "short";
}) {
  const router = useRouter();
  const initial = line.paidHours ?? null;
  const [paidText, setPaidText] = useState<string>(
    initial === null ? "" : String(initial),
  );
  const [saved, setSaved] = useState<number | null>(initial);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const parsed = parseHours(paidText);
  const dirty = paidText.trim() !== "" && parsed !== saved;

  function commit() {
    if (!dirty || parsed === null) return;
    setError(null);
    const value = parsed;
    startTransition(async () => {
      try {
        await setLinePaidHoursAction(line.id, value);
        setSaved(value);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save.");
      }
    });
  }

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
      <div className="min-w-0 grow">
        <div className="flex items-center gap-2">
          <span className="ro-num">#{entry.roNumber}</span>
          <span className="text-sm font-medium text-[var(--fg-1)] truncate">
            {label}
          </span>
          <span
            className={`pill ${status === "short" ? "bad" : ""}`}
          >
            {status === "short" ? "Short" : "Pending"}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--fg-3)]">
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
          value={paidText}
          onChange={(e) => setPaidText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="—"
          disabled={isPending}
          aria-label={`Paid flag hours for RO ${entry.roNumber} ${label}`}
          className="input mt-1 w-24 text-right text-base font-semibold"
        />
      </label>
    </div>
  );
}

export function ReconciliationCard({
  entries,
  library = [],
  rates = {},
}: {
  entries: Entry[];
  library?: OpCode[];
  rates?: RateMap;
}) {
  const router = useRouter();
  const [markingAll, setMarkingAll] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const libraryById = new Map(library.map((oc) => [oc.id, oc]));
  const summary = reconcileEntries(entries);
  const rows = unreconciledLines(entries);
  const showMoney = hasAnyRate(rates);
  const dollars = showMoney ? shortfallDollars(entries, rates) : null;

  // Every line still pending (null paid_hours) — the "mark all paid" targets.
  const pendingRows = rows.filter((r) => r.status === "pending");

  async function markAllPaid() {
    if (pendingRows.length === 0) return;
    setMarkError(null);
    setMarkingAll(true);
    try {
      for (const r of pendingRows) {
        await setLinePaidHoursAction(r.line.id, r.line.flagHours);
      }
      router.refresh();
    } catch (e) {
      setMarkError(e instanceof Error ? e.message : "Failed to mark all paid.");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <section className="card padded-lg space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Pay Reconciliation</h2>
        {pendingRows.length > 0 && (
          <button
            type="button"
            onClick={markAllPaid}
            disabled={markingAll}
            className="btn btn-sm btn-ghost"
          >
            {markingAll ? "Marking…" : "Mark all remaining as paid in full"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="field-label">Shorted hrs</div>
          <div
            className={`mt-1 text-lg font-semibold ${summary.shortedHours > 0 ? "text-[var(--bad)]" : "text-[var(--fg-1)]"}`}
          >
            {fmtHours(summary.shortedHours)}h
          </div>
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2">
          <div className="field-label">Pending lines</div>
          <div className="mt-1 text-lg font-semibold text-[var(--fg-1)]">
            {summary.pendingCount}
          </div>
        </div>
        {dollars !== null && (
          <div className="rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--bad)_30%,transparent)] bg-[var(--bad-bg)] px-3 py-2">
            <div className="field-label">Left on the table</div>
            <div
              className={`mt-1 text-lg font-semibold ${dollars > 0 ? "text-[var(--bad)]" : "text-[var(--fg-1)]"}`}
            >
              {fmtMoney(dollars)}
            </div>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-[color-mix(in_oklab,var(--good)_30%,transparent)] bg-[var(--good-bg)] px-3 py-2 text-sm text-[var(--good)]">
          All jobs reconciled for this period.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map(({ entry, line, status }) => (
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
    </section>
  );
}
