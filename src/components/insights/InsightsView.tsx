"use client";

import { useMemo, useState } from "react";
import { Lightbulb } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MixSection } from "@/components/insights/MixSection";
import {
  BigJobsSection,
  MaintenanceTimesSection,
} from "@/components/insights/JobTimeSections";
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
import { inferCodeDurations } from "@/lib/time-inference";
import {
  dayShapes,
  mixBands,
  mixDrivers,
  mixSummary,
} from "@/lib/mix";
import {
  bigJobCoverage,
  bigJobPerformance,
  displayedHours,
  formatRatio,
  gainBoard,
  leakBoard,
  opCodePerformance,
  opCodeState,
  periodTrend,
  ratioOrder,
  ratioTier,
  weekdayEfficiency,
  type Gain,
  type Leak,
  type LeakBoard,
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
  // Read off the DISPLAYED hours, not the raw totals: an unpaid-rework row shows
  // its comeback hours in the Actual column, and sorting that column by
  // actualTotal (0 for those rows) would order it by numbers nobody can see.
  const value = (r: OpCodePerformance): number | null => {
    if (col === "uses") return r.uses;
    if (col === "ratio") return ratioOrder(r);
    const shown = displayedHours(r);
    if (shown === null) return null;
    return col === "flag" ? shown.flag : shown.actual;
  };

  return [...rows].sort((a, b) => {
    if (col === "code") return sign * a.code.localeCompare(b.code);
    // A never-timed code has nothing to say about flag, actual or ratio. It
    // stays at the bottom in BOTH directions — otherwise sorting ascending
    // leads with a block of dashes and buries every row with real data.
    // Blankness is now "showed nothing", NOT "has no ratio": an unpaid row has
    // a null ratio and real hours, and pinning it down here is the bug.
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return b.uses - a.uses;
    if (av === null) return 1;
    if (bv === null) return -1;
    // Infinity - Infinity is NaN, which a comparator reads as "equal" and leaves
    // the unpaid block in arbitrary order. Rank those by hours bled instead.
    if (av === bv) return b.unpaidHours - a.unpaidHours || b.uses - a.uses;
    return sign * (av - bv) || b.uses - a.uses;
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

/** One line describing why a leak is a leak, in the tech's own vocabulary. */
function leakWhy(leak: Leak): string {
  const lines = `${leak.uses} ${leak.uses === 1 ? "job" : "jobs"}`;
  return leak.kind === "rework"
    ? `${leak.uses} comeback ${leak.uses === 1 ? "line" : "lines"}, zero flag`
    : `${lines} at ${formatRatio(leak.ratio as number)}× book`;
}

/**
 * The page's opening claim: everything unpaid, ranked, in hours.
 *
 * Leads with the total because that is the number a tech can act on — "which
 * job" is the follow-up question, not the first one. The bar is scaled to the
 * worst row rather than to the total, so the top row always fills it and the
 * rest read as a share of the worst offender instead of as slivers.
 */
/**
 * The page's opening claim, above the window chips on purpose.
 *
 * This surface's whole job is to reach a conclusion — opening on a control
 * instead makes the reader do the concluding, which is what the old chips-first
 * layout did. An empty board is a real finding too, and a better one.
 */
function FindingLede({ board }: { board: LeakBoard }) {
  if (board.leaks.length === 0) {
    return (
      <div>
        <p className="text-base font-semibold" style={{ color: "var(--fg-0)" }}>
          Nothing unpaid in this window.
        </p>
        <p className="mt-1 max-w-[60ch] text-sm" style={{ color: "var(--fg-2)" }}>
          Every job you timed came in at or under its book time, and no comeback
          hours went unflagged.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="mono tabular-nums text-[34px] font-bold leading-[1.1] tracking-[-0.02em]"
          style={{ color: "var(--bad)" }}
        >
          {fmtHours(board.totalHours)}h
        </span>
        <span className="text-base font-semibold" style={{ color: "var(--fg-0)" }}>
          you weren&rsquo;t paid for
        </span>
      </div>
      <p className="mt-2 max-w-[60ch] text-sm" style={{ color: "var(--fg-2)" }}>
        Time you were on the clock for and no flag hour covered, from every
        source the app can measure — ranked by what it cost you.
      </p>
    </div>
  );
}

function LeakSection({ board }: { board: LeakBoard }) {
  const worst = board.leaks[0]?.hours ?? 0;

  return (
    <section>
      <div className="section-title">What&rsquo;s costing you</div>
      <Card flush>
        {board.leaks.map((leak, i) => {
          // Rework is always the worse kind: it paid nothing at all, where an
          // overrun at least paid some of its time.
          const tier = leak.kind === "rework" ? "bad" : ratioTier(leak.ratio) ?? "warn";
          const pct = worst > 0 ? Math.max(2, (leak.hours / worst) * 100) : 0;
          return (
            <div key={leak.key} className="leak-row">
              <div className="leak-head">
                <span className="leak-rank" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="leak-name">
                  <span className="leak-code">{leak.code}</span>
                  <span className="leak-why">{leakWhy(leak)}</span>
                </span>
                <span className={`leak-hours ${tier === "bad" ? "bad" : "warn"}`}>
                  {fmtHours(leak.hours)}h
                </span>
              </div>
              <div className="leak-track">
                <i
                  className={`leak-fill${tier === "bad" ? " bad" : ""}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </Card>
      <p className="mt-2 px-1 text-xs" style={{ color: "var(--fg-3)" }}>
        Overrun is actual minus flag on jobs you timed. Unpaid rework has no
        ratio because it flags zero — the hours are the whole finding. Weekdays
        aren&rsquo;t listed here: a slow day is slow because of the jobs on it,
        so counting it again would inflate the total.
      </p>
    </section>
  );
}

/**
 * The other half of the ledger.
 *
 * Beating the book is the trade, not a consolation prize, and a page that only
 * ever reports losses stops getting opened. Kept deliberately smaller than the
 * leak board: it is reassurance, not the finding.
 */
function GainSection({ gains }: { gains: Gain[] }) {
  const shown = gains.slice(0, 3);
  return (
    <section>
      <div className="section-title">Where you&rsquo;re winning</div>
      <Card>
        {shown.map((gain) => (
          <div key={gain.key} className="gain-row">
            <span className="gain-name">
              <span className="text-sm font-semibold" style={{ color: "var(--fg-0)" }}>
                {gain.code}
              </span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--fg-3)" }}>
                {gain.uses} {gain.uses === 1 ? "job" : "jobs"} at{" "}
                {formatRatio(gain.ratio)}× book
              </span>
            </span>
            <span className="gain-hours">+{fmtHours(gain.hours)}h</span>
          </div>
        ))}
      </Card>
    </section>
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
  // Rework rows are not "nothing yet" — prompting for a timer while the table is
  // already showing hours the tech worked for free reads as the page ignoring it.
  const rework = rows.filter((r) => opCodeState(r) === "unpaid");
  const reworkHours = rework.reduce((sum, r) => sum + r.unpaidHours, 0);

  return (
    <section>
      <div className="section-title">Where your time goes</div>

      {/* Phone form. Same `shown` array, same sort state — a 5-column table
          clips its last column inside .card.flush at 390px, and that column is
          the ratio this whole section exists to show. The sort chips reuse the
          established filter-chip pattern rather than inventing a mobile-only
          control; pressing one is exactly the header press it replaces. */}
      <div className="opcode-list">
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
          {([
            { col: "ratio", label: "Worst first" },
            { col: "uses", label: "Most used" },
            { col: "code", label: "Code" },
          ] as { col: SortCol; label: string }[]).map((s) => (
            <button
              key={s.col}
              type="button"
              onClick={() => onSort(s.col)}
              className={`filter-chip${sortCol === s.col ? " active" : ""}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Card flush>
          {shown.map((row) => {
            const tier = ratioTier(row.ratio);
            const state = opCodeState(row);
            const shownHours = displayedHours(row);
            return (
              <div key={row.key} className="opcode-item">
                <div className="opcode-item-head">
                  <span className="opcode-item-name">
                    <span className="opcode-item-code">{row.code}</span>
                    {row.description && (
                      <span className="opcode-item-desc">{row.description}</span>
                    )}
                  </span>
                  {state === "measured" ? (
                    <span className={`pill${tier === "good" ? "" : ` ${tier}`}`}>
                      {formatRatio(row.ratio as number)}×
                    </span>
                  ) : state === "unpaid" ? (
                    <span className="pill bad">unpaid rework</span>
                  ) : (
                    <span className="table-dim text-xs">never timed</span>
                  )}
                </div>
                <p className="opcode-item-meta">
                  {row.uses} {row.uses === 1 ? "use" : "uses"}
                  {shownHours !== null &&
                    ` · ${fmtHours(shownHours.flag)}h flag → ${fmtHours(shownHours.actual)}h actual`}
                </p>
              </div>
            );
          })}
        </Card>
      </div>

      <div className="opcode-table">
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
              const state = opCodeState(row);
              const shownHours = displayedHours(row);
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
                    {shownHours === null ? "—" : `${fmtHours(shownHours.flag)}h`}
                  </Td>
                  <Td num dim>
                    {shownHours === null ? "—" : `${fmtHours(shownHours.actual)}h`}
                  </Td>
                  <Td num>
                    {state === "measured" ? (
                      <span className={`pill${tier === "good" ? "" : ` ${tier}`}`}>
                        {formatRatio(row.ratio as number)}×
                      </span>
                    ) : state === "unpaid" ? (
                      // No ratio, and deliberately no fabricated one — the flag
                      // is zero, so there is nothing to divide by. What the row
                      // says instead is the finding itself.
                      <span className="pill bad" title={`${row.unpaidUses} comeback ${row.unpaidUses === 1 ? "line" : "lines"} — no flag hours paid`}>
                        unpaid rework
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--fg-3)]">never timed</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <p className="text-xs text-[var(--fg-3)]">
          Actual ÷ flag over the jobs you put on a timer —{" "}
          <strong>lower is better</strong>. 1.00× means the book time was right;
          1.40× means the job eats 40% more clock than it pays.
          {rework.length > 0 && (
            <>
              {" "}
              <strong>Unpaid rework</strong> has no ratio because it flags zero —
              that&rsquo;s {fmtHours(reworkHours)}h of comeback time these codes
              cost you and paid nothing for.
            </>
          )}
          {timed === 0 && rework.length === 0 && " Time a few jobs and this fills in."}
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
  const last = points[points.length - 1];

  // FINISHED periods only. A period two days old has two days of hours in it,
  // and reading that against a complete period announced "efficiency is down
  // 108 points" the morning after a period rolled over — a collapse that exists
  // entirely in the arithmetic. The in-progress bar still draws, labelled,
  // because the hours in it are real.
  const complete = points.filter((p) => p.end < today);

  // THE SAME RULE NOW SETS THE AXIS, which is what was wrong with this chart.
  // Scaling to the tallest bar of ANY period let an unfinished one define the
  // ceiling: a period one day in, with one day of denominator, read 1565% and
  // squashed five real periods into 4px stubs. An incomplete period is not
  // comparable to the ones beside it, so it does not get to set the scale
  // either — it just clips, marked, with its true figure printed above it.
  //
  // Floored at 100 so the chart always contains par. Without the floor a tech
  // having a bad run sees every bar near the top, which reads as a good month.
  const scaleSource = complete.length > 0 ? complete : points;
  const ceiling = Math.max(100, ...scaleSource.map((p) => p.efficiency ?? 0));
  const BAR_MAX = 108;
  const parOffset = (100 / ceiling) * BAR_MAX;
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
        <div className="trend-plot">
          <div
            className="trend-par"
            style={{ bottom: parOffset }}
            aria-hidden="true"
          >
            <span className="trend-par-label">100%</span>
          </div>
          {points.map((point) => {
            const value = point.efficiency ?? 0;
            const clipped = value > ceiling;
            // Every bar keeps a visible stub so an all-zero period still reads
            // as a period rather than as missing data.
            const height = Math.max(4, (Math.min(value, ceiling) / ceiling) * BAR_MAX);
            const running = point.end >= today;
            return (
              <div key={point.key} className="trend-col">
                <span className="trend-val">{fmtPct(point.efficiency)}</span>
                <div
                  className={[
                    "trend-bar",
                    point === last && "is-current",
                    running && "is-running",
                    clipped && "is-clipped",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ height }}
                />
              </div>
            );
          })}
        </div>
        {/* Outside the plot so every bar shares one baseline — the in-progress
            column's extra line used to lift its bar and understate it. */}
        <div className="trend-labels">
          {points.map((point) => (
            <span key={point.key} className="trend-label">
              {point.label}
              {point.end >= today && <b>In progress</b>}
            </span>
          ))}
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
      {/* The "ignores the window above" half of this caption moved up into the
          All time heading, which now says it once for the whole half of the
          page rather than once per section. */}
      <p className="mt-2 px-1 text-xs text-[var(--fg-3)]">
        Always the last six pay periods — one period on its own is not a trend.
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
  // Both derived from the SAME rows the table renders, so the leaderboard and
  // the table can never disagree about one op code's hours.
  const leaks = useMemo(() => leakBoard(opCodes), [opCodes]);
  const gains = useMemo(() => gainBoard(opCodes), [opCodes]);
  const weekdays = useMemo(
    () => weekdayEfficiency(scopedEntries, scopedDenom),
    [scopedEntries, scopedDenom],
  );
  // Deliberately built from the FULL history, not the window — see the caption
  // on TrendSection.
  // Mix runs over EVERY day, not the windowed slice — see MixSection's header.
  // Quartiles cut from a one-week window are three days apiece.
  const mix = useMemo(() => {
    const days = dayShapes(entries, denomByDay);
    const bands = mixBands(days);
    const drivers = mixDrivers(days);
    return { days, bands, drivers, summary: mixSummary(bands, drivers) };
  }, [entries, denomByDay]);

  // Big jobs and the quick stuff both run over ALL history, like Mix and Trend:
  // a per-code ratio needs every reading it can get, and the solve below needs
  // as many days as exist.
  const bigJobs = useMemo(
    () => ({
      rows: bigJobPerformance(entries, library),
      coverage: bigJobCoverage(entries),
    }),
    [entries, library],
  );

  const inference = useMemo(
    () => inferCodeDurations(entries, denomByDay, library),
    [entries, denomByDay, library],
  );

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

  const chipRow = (
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
  );

  if (!hasAnyHistory) {
    return (
      <div className="space-y-6">
        {chipRow}
        <EmptyState
          icon={<Lightbulb size={22} />}
          title="Not enough data yet"
          description="Log your clocked hours and put a few jobs on the timer. Once the app knows how long a day was and how long a job took, this page can tell you which work is costing you."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Conclusion, then the control that scopes it, then the evidence. */}
      {hasWindowContent && <FindingLede board={leaks} />}
      {chipRow}

      {hasWindowContent ? (
        <>
          {leaks.leaks.length > 0 && <LeakSection board={leaks} />}
          {gains.length > 0 && <GainSection gains={gains} />}
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
            Pick a wider window above — the trend below still covers your whole
            history.
          </p>
        </Card>
      )}

      {/* The window chips stop here, and the page says so structurally instead
          of apologising for it in a caption under each section. */}
      {(trend.length > 0 || lifetime !== null || mix.days.length > 0) && (
        <div className="pt-2">
          <div style={{ height: 1, background: "var(--line)" }} />
          <div className="mt-5 flex items-baseline gap-3">
            <h2 className="text-xl font-semibold" style={{ color: "var(--fg-0)" }}>
              All time
            </h2>
            <span className="text-xs" style={{ color: "var(--fg-3)" }}>
              Ignores the window above
            </span>
          </div>
        </div>
      )}
      {mix.days.length > 0 && (
        <MixSection
          days={mix.days}
          bands={mix.bands}
          drivers={mix.drivers}
          summary={mix.summary}
        />
      )}
      <BigJobsSection rows={bigJobs.rows} coverage={bigJobs.coverage} />
      <MaintenanceTimesSection inference={inference} />
      {trend.length > 0 && <TrendSection points={trend} today={today} />}
      {/* Gated only on the migration having landed — the section handles
          "nothing recovered yet" itself. */}
      {lifetime !== null && (
        <RecoverySection lifetime={lifetime} insights={insights} />
      )}
    </div>
  );
}
