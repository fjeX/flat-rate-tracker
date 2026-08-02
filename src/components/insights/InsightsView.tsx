"use client";

import { useMemo, useState } from "react";
import { Lightbulb } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, Td, Th } from "@/components/ui/Table";
import { fmtHours, fmtPct, type DayDenom } from "@/lib/stats";
import { fmtMoney } from "@/lib/earnings";
import {
  endOfMonth,
  endOfWeek,
  getPeriodForDate,
  startOfMonth,
  startOfWeek,
} from "@/lib/periods";
import {
  opCodePerformance,
  periodTrend,
  ratioTier,
  weekdayEfficiency,
  type OpCodePerformance,
  type PeriodTrendPoint,
  type WeekdayEfficiency,
} from "@/lib/insights";
import {
  lifetimeRecovery,
  outcomeInsights,
  type LifetimeRecovery,
  type OutcomeInsight,
} from "@/lib/disputes";
import type { Dispute, Entry, OpCode, PeriodOverride } from "@/lib/types";

// Rows shown before the table collapses behind "Show all". Not a hard cap —
// with sortable columns a hidden tail would mean sorting ascending silently
// showed a different 15 rows than sorting descending.
const COLLAPSED_ROWS = 15;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type FilterKind = "week" | "period" | "month" | "all";

const CHIPS: { kind: FilterKind; label: string }[] = [
  { kind: "week", label: "Week" },
  { kind: "period", label: "Period" },
  { kind: "month", label: "Month" },
  { kind: "all", label: "All" },
];

type SortCol = "code" | "uses" | "flag" | "actual" | "ratio";
type SortDir = "asc" | "desc";
type WeekdaySort = "day" | "efficiency";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// Same windows as the History page, so the two pages mean the same thing by
// "Week" and "Period" — including honoring period overrides.
function getRange(
  kind: FilterKind,
  today: string,
  splitDay: number,
  periodOverrides: Record<string, PeriodOverride>,
  weekStartDay: 0 | 1,
): { start: string; end: string } | null {
  switch (kind) {
    case "week":
      return {
        start: startOfWeek(today, weekStartDay),
        end: endOfWeek(today, weekStartDay),
      };
    case "period": {
      const p = getPeriodForDate(today, splitDay, periodOverrides);
      return { start: p.start, end: p.end };
    }
    case "month":
      return { start: startOfMonth(today), end: endOfMonth(today) };
    case "all":
      return null;
  }
}

function sortOpCodes(
  rows: OpCodePerformance[],
  col: SortCol,
  dir: SortDir,
): OpCodePerformance[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (r: OpCodePerformance): number | null =>
    col === "uses"
      ? r.uses
      : col === "flag"
        ? r.flagTotal
        : col === "actual"
          ? r.actualTotal
          : r.ratio;

  return [...rows].sort((a, b) => {
    if (col === "code") return sign * a.code.localeCompare(b.code);
    // A never-timed code has nothing to say about flag, actual or ratio. It
    // stays at the bottom in BOTH directions — otherwise sorting ascending
    // leads with a block of dashes and buries every row with real data.
    const aBlank = col !== "uses" && a.ratio === null;
    const bBlank = col !== "uses" && b.ratio === null;
    if (aBlank && bBlank) return b.uses - a.uses;
    if (aBlank) return 1;
    if (bBlank) return -1;
    return sign * ((value(a) as number) - (value(b) as number)) || b.uses - a.uses;
  });
}

function SortHead({
  label,
  col,
  active,
  dir,
  onSort,
  num = false,
}: {
  label: string;
  col: SortCol;
  active: boolean;
  dir: SortDir;
  onSort: (col: SortCol) => void;
  num?: boolean;
}) {
  return (
    <Th num={num} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="table-sort"
        data-active={active}
        onClick={() => onSort(col)}
      >
        {label}
        <span className="table-sort-arrow" aria-hidden="true">
          {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </Th>
  );
}

// ---------------------------------------------------------------------------

function TimeGoesSection({
  rows,
  sortCol,
  sortDir,
  onSort,
}: {
  rows: OpCodePerformance[];
  sortCol: SortCol;
  sortDir: SortDir;
  onSort: (col: SortCol) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const timed = rows.filter((r) => r.ratio !== null).length;

  return (
    <section>
      <div className="section-title">Where your time goes</div>
      <Card flush>
        <Table>
          <thead>
            <tr>
              <SortHead label="Op code" col="code" active={sortCol === "code"} dir={sortDir} onSort={onSort} />
              <SortHead label="Uses" col="uses" num active={sortCol === "uses"} dir={sortDir} onSort={onSort} />
              <SortHead label="Flag" col="flag" num active={sortCol === "flag"} dir={sortDir} onSort={onSort} />
              <SortHead label="Actual" col="actual" num active={sortCol === "actual"} dir={sortDir} onSort={onSort} />
              <SortHead label="Actual vs flag" col="ratio" num active={sortCol === "ratio"} dir={sortDir} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const tier = ratioTier(row.ratio);
              return (
                <tr key={row.key}>
                  <Td>
                    <span className="font-medium text-[var(--fg-1)]">{row.code}</span>
                    {row.description && (
                      <span className="block text-xs text-[var(--fg-3)]">
                        {row.description}
                      </span>
                    )}
                  </Td>
                  <Td num dim>
                    {row.uses}
                  </Td>
                  <Td num dim>
                    {row.ratio === null ? "—" : `${fmtHours(row.flagTotal)}h`}
                  </Td>
                  <Td num dim>
                    {row.ratio === null ? "—" : `${fmtHours(row.actualTotal)}h`}
                  </Td>
                  <Td num>
                    {row.ratio === null ? (
                      <span className="text-xs text-[var(--fg-3)]">never timed</span>
                    ) : (
                      <span className={`pill${tier === "good" ? "" : ` ${tier}`}`}>
                        {row.ratio.toFixed(2)}×
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <p className="text-xs text-[var(--fg-3)]">
          Actual ÷ flag over the jobs you put on a timer —{" "}
          <strong>lower is better</strong>. 1.00× means the book time was right;
          1.40× means the job eats 40% more clock than it pays.
          {timed === 0 && " Time a few jobs and this fills in."}
        </p>
        {rows.length > COLLAPSED_ROWS && (
          <button
            type="button"
            className="link text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </section>
  );
}

function BestDaysSection({
  rows,
  sort,
  onSort,
}: {
  rows: WeekdayEfficiency[];
  sort: WeekdaySort;
  onSort: (s: WeekdaySort) => void;
}) {
  const worked = rows.filter((r) => r.efficiency !== null);
  const best = worked.reduce<WeekdayEfficiency | null>(
    (acc, r) => (acc === null || r.efficiency! > acc.efficiency! ? r : acc),
    null,
  );
  const worst = worked.reduce<WeekdayEfficiency | null>(
    (acc, r) => (acc === null || r.efficiency! < acc.efficiency! ? r : acc),
    null,
  );
  // One worked weekday is not a best and a worst, it's just the only one.
  const compare = worked.length >= 2 && best && worst && best !== worst;

  const ordered = useMemo(() => {
    if (sort === "day") return rows;
    return [...rows].sort((a, b) => {
      // Never-worked weekdays sink rather than leading with "—".
      if (a.efficiency === null && b.efficiency === null) return a.weekday - b.weekday;
      if (a.efficiency === null) return 1;
      if (b.efficiency === null) return -1;
      return b.efficiency - a.efficiency;
    });
  }, [rows, sort]);

  return (
    <section>
      <div className="section-title">Best days</div>
      <div className="filter-row" style={{ marginBottom: 8 }}>
        <span
          style={{
            fontSize: 12,
            color: "var(--fg-3)",
            fontWeight: 500,
            alignSelf: "center",
            flexShrink: 0,
          }}
        >
          Sort
        </span>
        {(["day", "efficiency"] as WeekdaySort[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSort(s)}
            className={`filter-chip${sort === s ? " active" : ""}`}
          >
            {s === "day" ? "By day" : "By efficiency"}
          </button>
        ))}
      </div>
      <Card>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {ordered.map((row) => {
            const isBest = compare && row === best;
            const isWorst = compare && row === worst;
            return (
              <div
                key={row.weekday}
                className={`card-inset px-2 py-3 text-center ${
                  isBest ? "ring-1 ring-[var(--good)]" : ""
                }`}
              >
                <div className="field-label">{WEEKDAY_LABELS[row.weekday]}</div>
                <div
                  className={`mono mt-1 text-base font-semibold tabular-nums ${
                    isBest
                      ? "text-[var(--good)]"
                      : isWorst
                        ? "text-[var(--warn)]"
                        : "text-[var(--fg-1)]"
                  }`}
                >
                  {fmtPct(row.efficiency)}
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--fg-3)]">
                  {row.days === 0
                    ? "—"
                    : `${row.days} day${row.days === 1 ? "" : "s"}`}
                </div>
              </div>
            );
          })}
        </div>
        {compare && (
          <p className="mt-3 text-xs text-[var(--fg-2)]">
            <span className="font-medium text-[var(--fg-1)]">
              {WEEKDAY_LABELS[best!.weekday]}
            </span>{" "}
            is your strongest day at {fmtPct(best!.efficiency)};{" "}
            {WEEKDAY_LABELS[worst!.weekday].toLowerCase()} runs{" "}
            {fmtPct(worst!.efficiency)}.
          </p>
        )}
      </Card>
      <p className="mt-2 px-1 text-xs text-[var(--fg-3)]">
        Counted only over days the app knows the length of — days you clocked in,
        or scheduled days that have already passed.
      </p>
    </section>
  );
}

function TrendSection({
  points,
  today,
}: {
  points: PeriodTrendPoint[];
  today: string;
}) {
  // Scale to the tallest bar rather than to 100%: a tech running 130% would
  // otherwise peg every bar at the ceiling and the trend would read flat.
  const max = Math.max(...points.map((p) => p.efficiency ?? 0), 1);
  const last = points[points.length - 1];

  // The comparison sentence uses only FINISHED periods. A period two days old
  // has two days of hours in it, and reading that against a complete period
  // announced "efficiency is down 108 points" the morning after a period rolled
  // over — a collapse that exists entirely in the arithmetic. The in-progress
  // bar still draws, labelled, because the hours in it are real.
  const complete = points.filter((p) => p.end < today);
  const deltaFrom = complete.length >= 2 ? complete[complete.length - 2] : null;
  const deltaTo = complete.length >= 2 ? complete[complete.length - 1] : null;
  const delta =
    deltaTo?.efficiency != null && deltaFrom?.efficiency != null
      ? deltaTo.efficiency - deltaFrom.efficiency
      : null;

  return (
    <section>
      <div className="section-title">Trend</div>
      <Card>
        <div className="flex items-end gap-2" style={{ height: 132 }}>
          {points.map((point) => {
            const value = point.efficiency ?? 0;
            // Every bar keeps a visible stub so an all-zero period still reads
            // as a period rather than as missing data.
            const height = Math.max(4, (value / max) * 104);
            const running = point.end >= today;
            return (
              <div
                key={point.key}
                className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="mono text-[11px] tabular-nums text-[var(--fg-3)]">
                  {fmtPct(point.efficiency)}
                </span>
                <div
                  className="w-full rounded-t-[4px]"
                  style={{
                    height,
                    background: point === last ? "var(--brand)" : "var(--bg-4)",
                    // Hatched rather than solid: this period isn't finished, so
                    // its bar is not comparable to the ones beside it.
                    opacity: running ? 0.55 : 1,
                  }}
                />
                <span className="truncate text-[10px] text-[var(--fg-3)]">
                  {point.label}
                </span>
                {running && (
                  <span className="text-[9px] uppercase tracking-wide text-[var(--fg-3)]">
                    in progress
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {/* Both figures, stated plainly, instead of the difference between them.
            The caption used to read "up 42 points" — correct (percentage points,
            i.e. subtract don't divide) and useless: the first tech to read it
            asked what a point was. A stat nobody can parse is a stat nobody
            trusts, and the two percentages say it without the vocabulary. */}
        {delta !== null && Math.abs(delta) >= 1 && (
          <p className="mt-3 text-xs text-[var(--fg-2)]">
            {deltaTo!.label} came in at{" "}
            <span className="font-medium text-[var(--fg-1)]">
              {fmtPct(deltaTo!.efficiency)}
            </span>
            , {delta > 0 ? "up from" : "down from"}{" "}
            <span className="font-medium text-[var(--fg-1)]">
              {fmtPct(deltaFrom!.efficiency)}
            </span>{" "}
            in {deltaFrom!.label}.
          </p>
        )}
      </Card>
      {/* "more than one point" was the old wording. Two senses of "point" a
          line apart, one of which we just removed for being unreadable. */}
      <p className="mt-2 px-1 text-xs text-[var(--fg-3)]">
        Always the last six pay periods — one period on its own is not a trend,
        so this section ignores the window above.
      </p>
    </section>
  );
}

function RecoverySection({
  lifetime,
  insights,
}: {
  lifetime: LifetimeRecovery;
  insights: OutcomeInsight[];
}) {
  // Rendered even with nothing recovered, unlike every other section here. A
  // tech went looking for this card, found no card at all, and could not tell
  // whether the feature existed or was broken. "Nothing yet, and here is how it
  // fills in" is a better answer than silence for the one number that says what
  // the app got back for them.
  if (lifetime.closedCount === 0) {
    return (
      <section>
        <div className="section-title">Claims and recovery</div>
        <Card>
          <p className="text-sm font-medium text-[var(--fg-1)]">
            Nothing recovered yet.
          </p>
          <p className="mt-1 text-sm text-[var(--fg-2)]">
            When a period comes up short, track the claim on the Pay Period page
            and record what actually came back. This is where FRT tells you what
            it got back for you.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section>
      <div className="section-title">Claims and recovery</div>
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card-inset px-3 py-2">
            <div className="field-label">Claims closed</div>
            <div className="mono mt-1 text-base font-semibold tabular-nums text-[var(--fg-1)]">
              {lifetime.closedCount}
            </div>
          </div>
          <div className="card-inset px-3 py-2">
            <div className="field-label">Got paid</div>
            <div className="mono mt-1 text-base font-semibold tabular-nums text-[var(--fg-1)]">
              {lifetime.winRate === null ? "—" : pct(lifetime.winRate)}
            </div>
          </div>
          <div className="card-inset px-3 py-2">
            <div className="field-label">Hours recovered</div>
            <div className="mono mt-1 text-base font-semibold tabular-nums text-[var(--fg-1)]">
              {lifetime.hourRecoveryRate === null
                ? "—"
                : pct(lifetime.hourRecoveryRate)}
            </div>
          </div>
          <div className="card-inset px-3 py-2">
            <div className="field-label">Recovered</div>
            <div className="mono mt-1 text-base font-semibold tabular-nums text-[var(--good)]">
              {lifetime.recoveredDollars !== null
                ? fmtMoney(lifetime.recoveredDollars)
                : `${fmtHours(lifetime.recoveredHours)}h`}
            </div>
          </div>
        </div>

        {insights.map((i) => (
          <p key={i.id} className="text-xs text-[var(--fg-2)]">
            <span className="font-medium text-[var(--fg-1)]">{i.betterLabel}</span>{" "}
            claims get paid {pct(i.betterRate)} of the time ({i.betterCount}{" "}
            closed) vs {pct(i.worseRate)} for{" "}
            <span className="font-medium text-[var(--fg-1)]">
              {i.worseLabel.toLowerCase()}
            </span>{" "}
            ({i.worseCount} closed).
          </p>
        ))}
      </Card>
      <p className="mt-2 px-1 text-xs text-[var(--fg-3)]">
        Lifetime figures across every claim you have ever raised.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

export function InsightsView({
  entries,
  denomByDay,
  library,
  splitDay,
  periodOverrides,
  today,
  weekStartDay,
  disputes,
}: {
  entries: Entry[];
  denomByDay: Record<string, DayDenom>;
  library: OpCode[];
  splitDay: number;
  periodOverrides: Record<string, PeriodOverride>;
  today: string;
  weekStartDay: 0 | 1;
  // Null pre-migration — the recovery section disappears rather than crashing,
  // same contract as every other dispute-ledger read surface.
  disputes: Dispute[] | null;
}) {
  const [filter, setFilter] = useState<FilterKind>("all");
  const [sortCol, setSortCol] = useState<SortCol>("ratio");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [weekdaySort, setWeekdaySort] = useState<WeekdaySort>("day");

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortCol(col);
      // Text sorts read naturally A→Z; every numeric column is more useful
      // biggest-first (worst ratio, most-used code).
      setSortDir(col === "code" ? "asc" : "desc");
    }
  }

  const range = useMemo(
    () => getRange(filter, today, splitDay, periodOverrides, weekStartDay),
    [filter, today, splitDay, periodOverrides, weekStartDay],
  );

  const scopedEntries = useMemo(
    () =>
      range === null
        ? entries
        : entries.filter((e) => e.date >= range.start && e.date <= range.end),
    [entries, range],
  );

  const scopedDenom = useMemo(() => {
    if (range === null) return denomByDay;
    const out: Record<string, DayDenom> = {};
    for (const [date, denom] of Object.entries(denomByDay)) {
      if (date >= range.start && date <= range.end) out[date] = denom;
    }
    return out;
  }, [denomByDay, range]);

  const opCodes = useMemo(
    () => opCodePerformance(scopedEntries, library),
    [scopedEntries, library],
  );
  const sortedOpCodes = useMemo(
    () => sortOpCodes(opCodes, sortCol, sortDir),
    [opCodes, sortCol, sortDir],
  );
  const weekdays = useMemo(
    () => weekdayEfficiency(scopedEntries, scopedDenom),
    [scopedEntries, scopedDenom],
  );
  // Deliberately built from the FULL history, not the window — see the caption
  // on TrendSection.
  const trend = useMemo(
    () => periodTrend(entries, denomByDay, { splitDay, periodOverrides }),
    [entries, denomByDay, splitDay, periodOverrides],
  );

  const lifetime = disputes ? lifetimeRecovery(disputes) : null;
  const insights = disputes ? outcomeInsights(disputes) : [];
  const hasWorkedDays = weekdays.some((w) => w.efficiency !== null);

  // Two different questions, and conflating them left an empty window showing a
  // lone Trend chart with nothing explaining why everything else vanished.
  //   hasWindowContent — do the WINDOWED sections have anything to draw?
  //   hasAnyHistory    — is there anything in this account at all?
  // Trend and Recovery span all history, so they can't answer the first one.
  const hasWindowContent = opCodes.length > 0 || hasWorkedDays;
  const hasAnyHistory =
    entries.length > 0 ||
    Object.keys(denomByDay).length > 0 ||
    (lifetime !== null && lifetime.closedCount > 0);

  return (
    <div className="space-y-6">
      <div className="filter-row">
        {CHIPS.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            onClick={() => setFilter(chip.kind)}
            className={`filter-chip${filter === chip.kind ? " active" : ""}`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {!hasAnyHistory ? (
        <EmptyState
          icon={<Lightbulb size={22} />}
          title="Not enough data yet"
          description="Log your clocked hours and put a few jobs on the timer. Once the app knows how long a day was and how long a job took, this page can tell you which work is costing you."
        />
      ) : (
        <>
          {hasWindowContent ? (
            <>
              {opCodes.length > 0 && (
                <TimeGoesSection
                  rows={sortedOpCodes}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
              )}
              {hasWorkedDays && (
                <BestDaysSection
                  rows={weekdays}
                  sort={weekdaySort}
                  onSort={setWeekdaySort}
                />
              )}
            </>
          ) : (
            <Card>
              <p className="text-sm text-[var(--fg-2)]">
                No work recorded in this {filter === "period" ? "pay period" : filter}.
                Pick a wider window above — the trend below still covers your
                whole history.
              </p>
            </Card>
          )}
          {trend.length > 0 && <TrendSection points={trend} today={today} />}
          {/* Gated only on the migration having landed — the section handles
              "nothing recovered yet" itself. */}
          {lifetime !== null && (
            <RecoverySection lifetime={lifetime} insights={insights} />
          )}
        </>
      )}
    </div>
  );
}
