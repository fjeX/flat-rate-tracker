"use client";

import { useMemo, useState } from "react";
import { Lightbulb } from "lucide-react";
import { Zone } from "@/components/ui/Zone";
import { Badge } from "@/components/ui/Badge";
import { Head, HeadCell, HeadCells, HeadNote } from "@/components/ui/Card";
import { withPt } from "@/components/ui/Figure";
import { MixSection } from "@/components/insights/MixSection";
import {
  BigJobsSection,
  MaintenanceTimesSection,
} from "@/components/insights/JobTimeSections";
import { EmptyState } from "@/components/ui/EmptyState";
import { OriginTag } from "@/components/insights/OriginTag";
import { Table, Td, Th } from "@/components/ui/Table";
import {
  fmtHours,
  fmtPct,
  unpairedNoteClause,
  unpairedNotes,
  type DayDenom,
  type UnpairedNote,
} from "@/lib/stats";
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
  topUpsoldCodes,
  upsellByPeriod,
  type UpsellPeriodPoint,
  type UpsoldCode,
} from "@/lib/upsells";
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
  displayedUses,
  formatRatio,
  gainBoard,
  leakBoard,
  opCodePerformance,
  opCodeState,
  periodTrend,
  ratioOrder,
  ratioTier,
  trendEfficiencyDisplay,
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
import { buildUnpaidSummary } from "@/lib/unpaid-summary";
import type {
  Dispute,
  Entry,
  OpCode,
  PeriodOverride,
  UnpaidTime,
} from "@/lib/types";

// Phase 5 sketch: every section is a Zone, the window and sort chips are
// segmented controls, the pills are tags, and the bars use the page's bar
// tokens. Every calculation and every sentence is as it was — the bot and the
// tests key on the wording.

// Rows shown before the table collapses behind "Show all". Not a hard cap —
// with sortable columns a hidden tail would mean sorting ascending silently
// showed a different 15 rows than sorting descending.
const COLLAPSED_ROWS = 15;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The tallest trend bar, as a percentage of the plot's height (phase 5: the
 * plot grows on wider screens, so bars are no longer sized in pixels). The
 * ceiling bar reaches this; the value labels sit in the remaining headroom.
 * Exported for TrendSection's test, which asserts bar heights against it.
 */
export const TREND_BAR_MAX = 86;

type FilterKind = "week" | "period" | "month" | "all";

const CHIPS: { kind: FilterKind; label: string }[] = [
  { kind: "week", label: "Week" },
  { kind: "period", label: "Period" },
  { kind: "month", label: "Month" },
  { kind: "all", label: "All" },
];

export type SortCol = "code" | "uses" | "flag" | "actual" | "ratio";
export type SortDir = "asc" | "desc";
type WeekdaySort = "day" | "efficiency";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** A figure with its unit as a word: "12.4" + "h". */
function Hours({ value, unit = "h" }: { value: string; unit?: string }) {
  return (
    <span className="num">
      {withPt(value)}
      <span className="unit">{unit}</span>
    </span>
  );
}

/** The ratio as a tag: colour is state (red = costing you, green = beating the book). */
function RatioTag({ ratio, tier }: { ratio: number; tier: "good" | "warn" | "bad" | null }) {
  const tone = tier === "bad" ? "bad" : tier === "good" ? "good" : "neutral";
  return <Badge tone={tone}>{formatRatio(ratio)}×</Badge>;
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

// Exported for its own test: the tie-breakers below are the part that silently
// ordered rows by numbers nobody can see, and a comparator is only provable by
// calling it.
export function sortOpCodes(
  rows: OpCodePerformance[],
  col: SortCol,
  dir: SortDir,
): OpCodePerformance[] {
  const sign = dir === "asc" ? 1 : -1;
  // Read off the DISPLAYED hours, not the raw totals: an unpaid-rework row shows
  // its comeback hours in the Actual column, and sorting that column by
  // actualTotal (0 for those rows) would order it by numbers nobody can see.
  const value = (r: OpCodePerformance): number | null => {
    // Same rule as the hours below: an unpaid-rework row PRINTS its comeback
    // count, so the column has to order by that and not by the total.
    if (col === "uses") return displayedUses(r);
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
    // TIE-BREAKERS ORDER BY WHAT IS ON SCREEN, and they follow `sign`.
    // `b.uses - a.uses` did neither: an unpaid row PRINTS `unpaidUses`, so two
    // rows both showing "2 uses" were ordered by the invisible raw 8-vs-3, and
    // always descending — flip the arrow and the tied block stayed put, which
    // reads as a sort that half worked. Equal displayed values now return 0 and
    // Array#sort's stability keeps the incoming order.
    const tie = () => sign * (displayedUses(a) - displayedUses(b));
    if (av === null && bv === null) return tie();
    if (av === null) return 1;
    if (bv === null) return -1;
    // Infinity - Infinity is NaN, which a comparator reads as "equal" and leaves
    // the unpaid block in arbitrary order. Rank those by hours bled instead.
    if (av === bv) return b.unpaidHours - a.unpaidHours || tie();
    return sign * (av - bv) || tie();
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

/** A segmented control for a small set of choices. */
function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** One line describing why a leak is a leak, in the tech's own vocabulary. */
function leakWhy(leak: Leak): string {
  // Ledger rows first: they have no op code, no book time and no ratio, so the
  // only honest thing to count is how many entries are behind the hours. Said
  // as "entries" rather than "lines" because they are not on a ticket at all.
  if (leak.source === "ledger") {
    return `${leak.uses} ${leak.uses === 1 ? "entry" : "entries"}, no flag hours`;
  }
  const lines = `${leak.uses} ${leak.uses === 1 ? "job" : "jobs"}`;
  return leak.kind === "rework"
    ? `${leak.uses} comeback ${leak.uses === 1 ? "line" : "lines"}, zero flag`
    : `${lines} at ${formatRatio(leak.ratio as number)}× book`;
}

/**
 * The page's opening claim, above the window chips on purpose.
 *
 * This surface's whole job is to reach a conclusion — opening on a control
 * instead makes the reader do the concluding, which is what the old chips-first
 * layout did. An empty board is a real finding too, and a better one.
 *
 * Phase 5 (Liem: "section after section of data, nothing stands out"): the
 * claim is now the page's headline panel, like the dashboard's Today and Pay
 * Period's totals — four figures a tech can read before any evidence. The
 * unpaid total leads because that is the number a tech can act on; "which
 * job" is the follow-up question, not the first one.
 */
function FindingLede({
  board,
  bestDay,
  trend,
  soldShare,
}: {
  board: LeakBoard;
  bestDay: WeekdayEfficiency | null;
  trend: { to: PeriodTrendPoint; toPct: number; fromPct: number | null } | null;
  soldShare: number | null;
}) {
  const clean = board.leaks.length === 0;
  const trendDelta = trend && trend.fromPct != null ? trend.toPct - trend.fromPct : null;
  return (
    <Head className="ins-verdict">
      <HeadCells className="ins-verdict-cells">
        <HeadCell
          label="Unpaid this window"
          className={clean ? undefined : "is-bad"}
          value={clean ? "0" : withPt(fmtHours(board.totalHours))}
          unit="h"
          sub={
            clean
              ? "every timed job came in at book"
              : `${board.leaks.length} ${board.leaks.length === 1 ? "source" : "sources"}, ranked below`
          }
        />
        <HeadCell
          label="Strongest day"
          value={bestDay ? withPt(fmtPct(bestDay.efficiency)) : "—"}
          sub={bestDay ? `${WEEKDAY_LABELS[bestDay.weekday]}s, over ${bestDay.days} ${bestDay.days === 1 ? "day" : "days"}` : "no measured days yet"}
        />
        <HeadCell
          label="Last period"
          value={trend ? withPt(fmtPct(trend.toPct)) : "—"}
          sub={
            trend
              ? trendDelta === null
                ? trend.to.label
                : `${trendDelta > 0 ? "up from" : trendDelta < 0 ? "down from" : "level with"} ${fmtPct(trend.fromPct)}`
              : "no finished period yet"
          }
        />
        <HeadCell
          label="Sold"
          value={soldShare === null ? "—" : withPt(`${Math.round(soldShare * 100)}`)}
          unit={soldShare === null ? undefined : "%"}
          sub={soldShare === null ? "nothing marked as an upsell" : "of everything you flagged"}
        />
      </HeadCells>
      {/* Names the three sources instead of claiming "every source the app can
          measure". The old wording was an affirmative claim about coverage the
          board did not have — the unpaid-time ledger was structurally
          unreachable from it — and a claim like that is worse than a gap,
          because it tells the tech to stop looking. Say what is in the number. */}
      <HeadNote>
        {clean ? (
          <>
            <b>Nothing unpaid in this window.</b> Every job you timed came in at
            or under its book time, no comeback hours went unflagged, and your
            unpaid-time ledger is empty for this window.
          </>
        ) : (
          <>
            <b>{fmtHours(board.totalHours)}h you weren&rsquo;t paid for.</b>{" "}
            Jobs that ran past their book time, comebacks that flagged zero, and
            every hour in your unpaid-time ledger — ranked by what it cost you.
          </>
        )}
      </HeadNote>
    </Head>
  );
}

// Exported for its colocated test only — still rendered by InsightsView alone.
// The board prints `leak.code`, and an op-code-sourced row's code is exactly as
// ambiguous here as it is on "Where your time goes": two byte-identical WHL-BRG
// rows landed at rank 2 and rank 16 with nothing on screen separating them.
export function LeakSection({ board }: { board: LeakBoard }) {
  const worst = board.leaks[0]?.hours ?? 0;

  return (
    <Zone
      name="What's costing you"
      aside={<span className="ins-aside ins-bad"><Hours value={fmtHours(board.totalHours)} /></span>}
    >
      {/* The bar is scaled to the worst row rather than to the total, so the
          top row always fills it and the rest read as a share of the worst
          offender instead of as slivers. */}
      <ol className="ins-rows">
        {board.leaks.map((leak, i) => {
          // An overrun at least paid some of its time; rework and unpaid clock
          // paid none of it, so both are the worse kind. Keyed on "is this an
          // overrun" rather than listing the bad kinds, so a fourth kind can
          // never default itself into the softer colour.
          const tier =
            leak.kind === "overrun" ? ratioTier(leak.ratio) ?? "warn" : "bad";
          const pct = worst > 0 ? Math.max(2, (leak.hours / worst) * 100) : 0;
          return (
            <li key={leak.key}>
              <div className="ins-row-head">
                <span className="ins-rank" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="ins-row-name">
                  <span className="ins-row-code">{leak.code}</span>
                  {/* Gated on `source`, NOT on the key's prefix. An opcode leak
                      keys `lib:<id>:overrun` / `custom:<CODE>:rework`, which
                      opCodeOrigin reads correctly; a ledger leak keys
                      `ledger:<kind>`, which has no origin at all and would be
                      silently labelled "custom" — a made-up provenance on a row
                      that has no op code by definition. */}
                  {leak.source === "opcode" && <OriginTag row={leak} />}
                  <span className="ins-row-why">{leakWhy(leak)}</span>
                </span>
                <span className={`ins-row-fig${tier === "bad" ? " ins-bad" : ""}`}>
                  <Hours value={fmtHours(leak.hours)} />
                </span>
              </div>
              <div className="ins-track">
                <i className={tier === "bad" ? "is-bad" : undefined} style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="ins-fine">
        Overrun is actual minus flag on jobs you timed. Unpaid rework has no
        ratio because it flags zero — the hours are the whole finding. Ledger
        time (waiting, shop time, comebacks with no ticket) has no op code, so
        it is grouped by what it was. Weekdays aren&rsquo;t listed here: a slow
        day is slow because of the jobs on it, so counting it again would
        inflate the total.
      </p>
    </Zone>
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
  const total = shown.reduce((s, g) => s + g.hours, 0);
  return (
    <Zone
      name="Where you're winning"
      aside={<span className="ins-aside ins-good">+<Hours value={fmtHours(total)} /></span>}
    >
      <ul className="ins-gains">
        {shown.map((gain) => (
          <li key={gain.key}>
            <span className="ins-row-name">
              <span className="ins-row-code">{gain.code}</span>
              <span className="ins-row-why">
                {gain.uses} {gain.uses === 1 ? "job" : "jobs"} at{" "}
                {formatRatio(gain.ratio)}× book
              </span>
            </span>
            <span className="ins-row-fig ins-good">
              +<Hours value={fmtHours(gain.hours)} />
            </span>
          </li>
        ))}
      </ul>
    </Zone>
  );
}

// ---------------------------------------------------------------------------

// Exported for its colocated test only — the section is still rendered by
// InsightsView alone. Both of the tables inside it print a per-row count and a
// per-row identity, and both got those wrong in ways only a render test catches.
export function TimeGoesSection({
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
    <Zone
      name="Where your time goes"
      aside={<span className="ins-aside"><span className="num">{rows.length}</span> codes · <span className="num">{timed}</span> timed</span>}
    >
      {/* Phone form. Same `shown` array, same sort state — a 5-column table
          clips its last column at 390px, and that column is the ratio this
          whole section exists to show. Pressing a sort button is exactly the
          header press it replaces. */}
      <div className="ins-oplist">
        <div className="seg" role="group" aria-label="Sort">
          {([
            { col: "ratio", label: "Worst first" },
            { col: "uses", label: "Most used" },
            { col: "code", label: "Code" },
          ] as { col: SortCol; label: string }[]).map((s) => (
            <button
              key={s.col}
              type="button"
              aria-pressed={sortCol === s.col}
              onClick={() => onSort(s.col)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div>
          {shown.map((row) => {
            const tier = ratioTier(row.ratio);
            const state = opCodeState(row);
            const shownHours = displayedHours(row);
            return (
              <div key={row.key} className="ins-opitem">
                <div className="ins-opitem-head">
                  <span className="ins-opitem-name">
                    <span className="ins-row-code">{row.code}</span>
                    {/* `op_codes.code` has no unique constraint and a one-time
                        line's text is free, so the code alone does not identify
                        a row. Description was the only thing telling them apart
                        and it is routinely empty. Read off the group key, which
                        has always kept them separate. */}
                    <OriginTag row={row} />
                    {row.description && (
                      <span className="ins-opitem-desc">{row.description}</span>
                    )}
                  </span>
                  {state === "measured" ? (
                    <RatioTag ratio={row.ratio as number} tier={tier} />
                  ) : state === "unpaid" ? (
                    <Badge tone="bad">unpaid rework</Badge>
                  ) : (
                    <span className="ins-dim">never timed</span>
                  )}
                </div>
                <p className="ins-opitem-meta">
                  {/* The count the hours beside it came from. On an unpaid row
                      that is the comeback subset, not every line of the code —
                      see displayedUses. */}
                  {displayedUses(row)} {displayedUses(row) === 1 ? "use" : "uses"}
                  {shownHours !== null &&
                    ` · ${fmtHours(shownHours.flag)}h flag → ${fmtHours(shownHours.actual)}h actual`}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ins-optable">
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
                    <span className="ins-row-code">{row.code}</span>
                    <OriginTag row={row} />
                    {row.description && (
                      <span className="ins-cell-sub">{row.description}</span>
                    )}
                  </Td>
                  <Td num dim>
                    {displayedUses(row)}
                  </Td>
                  <Td num dim>
                    {shownHours === null ? "—" : `${fmtHours(shownHours.flag)}h`}
                  </Td>
                  <Td num dim>
                    {shownHours === null ? "—" : `${fmtHours(shownHours.actual)}h`}
                  </Td>
                  <Td num>
                    {state === "measured" ? (
                      <RatioTag ratio={row.ratio as number} tier={tier} />
                    ) : state === "unpaid" ? (
                      // No ratio, and deliberately no fabricated one — the flag
                      // is zero, so there is nothing to divide by. What the row
                      // says instead is the finding itself.
                      <Badge tone="bad" title={`${row.unpaidUses} comeback ${row.unpaidUses === 1 ? "line" : "lines"} — no flag hours paid`}>
                        unpaid rework
                      </Badge>
                    ) : (
                      <span className="ins-dim">never timed</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <div className="ins-table-note">
        <p className="ins-fine">
          Actual ÷ flag over the jobs you put on a timer —{" "}
          <b>lower is better</b>. 1.00× means the book time was right;
          1.40× means the job eats 40% more clock than it pays.
          {rework.length > 0 && (
            <>
              {" "}
              <b>Unpaid rework</b> has no ratio because it flags zero —
              that&rsquo;s {fmtHours(reworkHours)}h of comeback time these codes
              cost you and paid nothing for.
            </>
          )}
          {timed === 0 && rework.length === 0 && " Time a few jobs and this fills in."}
        </p>
        {rows.length > COLLAPSED_ROWS && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </Zone>
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
    <Zone
      name="Best days"
      aside={
        best ? (
          <span className="ins-aside">
            <span className="num ins-good">{withPt(fmtPct(best.efficiency))}</span> {WEEKDAY_LABELS[best.weekday]}
          </span>
        ) : undefined
      }
    >
      <Seg
        label="Sort"
        value={sort}
        onChange={onSort}
        options={[
          { value: "day", label: "By day" },
          { value: "efficiency", label: "By efficiency" },
        ]}
      />
      <div className="ins-days">
        {ordered.map((row) => {
          const isBest = compare && row === best;
          const isWorst = compare && row === worst;
          return (
            <div key={row.weekday} className={`ins-day${isBest ? " is-best" : ""}`}>
              <div className="ins-day-k">{WEEKDAY_LABELS[row.weekday]}</div>
              <span className={`num${isBest ? " ins-good" : isWorst ? " ins-bad" : ""}`}>
                {withPt(fmtPct(row.efficiency))}
              </span>
              <small>
                {row.days === 0
                  ? "—"
                  : `${row.days} day${row.days === 1 ? "" : "s"}`}
              </small>
            </div>
          );
        })}
      </div>
      {compare && (
        <p className="ins-fine">
          <b>{WEEKDAY_LABELS[best!.weekday]}</b> is your strongest day at{" "}
          {fmtPct(best!.efficiency)}; {WEEKDAY_LABELS[worst!.weekday]} runs{" "}
          {fmtPct(worst!.efficiency)}.
        </p>
      )}
      <p className="ins-fine">
        Counted only over days the app knows the length of — days you clocked in,
        or scheduled days that have already passed.
      </p>
    </Zone>
  );
}

/**
 * Exported for its co-located test, the same way PeriodOverrideModal exports
 * `snapshot`. Driving the whole InsightsView through RTL to reach this chart
 * would exercise a dozen sibling sections and go red whenever any of them was
 * mid-edit — a regression test that fails for other people's reasons gets
 * muted, and then it isn't a gate.
 */
export function TrendSection({
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

  // The printable percentage per bar, or null when there isn't one.
  //
  // Routed through the trend-shape adapter, NOT efficiencyDisplay directly: a
  // PeriodTrendPoint keeps its unpaired hours OUTSIDE `flagHours` while
  // ScheduleStats keeps them inside, and the classifier is written against the
  // ScheduleStats convention. See trendEfficiencyDisplay in lib/insights.
  //
  // Keyed by period key rather than recomputed at each use, so the label, the
  // bar height, the axis and the caption below cannot answer differently.
  const shownPct = new Map<string, number | null>(
    points.map((p) => {
      const d = trendEfficiencyDisplay(p);
      return [p.key, d.kind === "shown" ? d.pct : null];
    }),
  );
  const measured = (p: PeriodTrendPoint) => shownPct.get(p.key) != null;

  // THE SAME RULE NOW SETS THE AXIS, which is what was wrong with this chart.
  // Scaling to the tallest bar of ANY period let an unfinished one define the
  // ceiling: a period one day in, with one day of denominator, read 1565% and
  // squashed five real periods into 4px stubs. An incomplete period is not
  // comparable to the ones beside it, so it does not get to set the scale
  // either — it just clips, marked, with its true figure printed above it.
  //
  // A WITHHELD percentage is excluded from the scale for the same reason and
  // one more: it is not merely incomparable, it is not a measurement. A
  // fortnight whose flagged work all landed on unscheduled Saturdays produces a
  // number built from a hollowed-out numerator, and letting it set the ceiling
  // would rescale five honest bars against a figure the chart is refusing to
  // print. If nothing is measured the floor stands alone at 100.
  //
  // Floored at 100 so the chart always contains par. Without the floor a tech
  // having a bad run sees every bar near the top, which reads as a good month.
  const completeMeasured = complete.filter(measured);
  const scaleSource =
    completeMeasured.length > 0 ? completeMeasured : points.filter(measured);
  const ceiling = Math.max(100, ...scaleSource.map((p) => shownPct.get(p.key)!));
  const BAR_MAX = TREND_BAR_MAX;
  const parOffset = (100 / ceiling) * BAR_MAX;
  // Hours that are in no percentage on this page, because the app never learned
  // how long those days were. Stated rather than dropped: the pairing rule is
  // right, but "we quietly removed 40 hours of your work from the math" is not
  // something a page gets to do silently, and the fix is one the tech can act
  // on (clock the day, or put it on the schedule).
  const unpaired = points.filter((p) => p.unpairedFlagHours > 0);
  // Split by REASON before totalling. The caption below used to be one hardcoded
  // sentence — byte-for-byte the pay-period one — telling the tech to clock the
  // day or put it on the schedule, which is the wrong instruction for a shift
  // that is simply still running. Both surfaces now branch on the same notes and
  // print the same clause from lib/stats.
  const notes: (UnpairedNote & { labels: string[] })[] = [];
  for (const point of unpaired) {
    for (const note of unpairedNotes(point.unpairedByReason, {
      flagHours: point.unpairedFlagHours,
      days: point.unpairedDays,
    })) {
      const found = notes.find((n) => n.kind === note.kind);
      if (found) {
        found.flagHours += note.flagHours;
        found.days += note.days;
        if (!found.labels.includes(point.label)) found.labels.push(point.label);
      } else {
        notes.push({ ...note, labels: [point.label] });
      }
    }
  }

  const deltaFrom = complete.length >= 2 ? complete[complete.length - 2] : null;
  const deltaTo = complete.length >= 2 ? complete[complete.length - 1] : null;
  // Both endpoints have to be printable. "came in at 0%, down from 138%" is the
  // same hollowed-numerator claim as the bar label, stated in a full sentence —
  // worse, not better, because a sentence sounds deliberate.
  const fromPct = deltaFrom ? (shownPct.get(deltaFrom.key) ?? null) : null;
  const toPct = deltaTo ? (shownPct.get(deltaTo.key) ?? null) : null;
  const delta = toPct != null && fromPct != null ? toPct - fromPct : null;

  return (
    <Zone
      name="Trend"
      aside={
        toPct != null ? (
          <span className="ins-aside">
            <span className="num">{withPt(fmtPct(toPct))}</span>
            {delta !== null && Math.abs(delta) >= 1 && (
              <span className={delta > 0 ? "ins-good" : "ins-bad"} aria-hidden="true">
                {" "}{delta > 0 ? "↑" : "↓"}
              </span>
            )}
          </span>
        ) : undefined
      }
    >
      <div className="ins-trend">
        <div className="ins-trend-plot">
          <div
            className="ins-par"
            style={{ bottom: `${parOffset}%` }}
            aria-hidden="true"
          >
            <span>100%</span>
          </div>
          {points.map((point) => {
            const pct = shownPct.get(point.key) ?? null;
            // A withheld bar still DRAWS — the flagged hours in it are real and
            // a missing column would read as a period that never happened. What
            // it does not do is claim a height: this bar's height IS its
            // percentage, so a withheld figure has no height to draw, and it
            // falls to the same minimum stub an all-zero period gets. The dash
            // above it, and the "not counted" caption below the chart, say why.
            const value = pct ?? 0;
            const clipped = pct !== null && value > ceiling;
            // Every bar keeps a visible stub so an all-zero period still reads
            // as a period rather than as missing data.
            const height = Math.max(4, (Math.min(value, ceiling) / ceiling) * BAR_MAX);
            const running = point.end >= today;
            return (
              <div key={point.key} className="ins-trend-col">
                <span className="trend-val">{fmtPct(pct)}</span>
                <div
                  className={[
                    "trend-bar",
                    point === last && "is-current",
                    running && "is-running",
                    clipped && "is-clipped",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
        {/* Outside the plot so every bar shares one baseline — the in-progress
            column's extra line used to lift its bar and understate it. */}
        <div className="ins-trend-x">
          {points.map((point) => (
            <span key={point.key} className={point === last ? "is-current" : undefined}>
              {point.label}
              {point.end >= today && <b>In progress</b>}
            </span>
          ))}
        </div>
      </div>
      {/* Both figures, stated plainly, instead of the difference between them.
          The caption used to read "up 42 points" — correct (percentage points,
          i.e. subtract don't divide) and useless: the first tech to read it
          asked what a point was. A stat nobody can parse is a stat nobody
          trusts, and the two percentages say it without the vocabulary. */}
      {delta !== null && Math.abs(delta) >= 1 && (
        <p className="ins-fine">
          {deltaTo!.label} came in at <b>{fmtPct(toPct)}</b>,{" "}
          {delta > 0 ? "up from" : "down from"} <b>{fmtPct(fromPct)}</b> in{" "}
          {deltaFrom!.label}.
        </p>
      )}
      {notes.map((note) => (
        <p key={note.kind} className="ins-fine">
          Not counted above: <b>{fmtHours(note.flagHours)}h</b> flagged across{" "}
          {note.days} {note.days === 1 ? "day" : "days"}{" "}
          {note.labels.length === 1 ? `in ${note.labels[0]}` : "in these periods"}{" "}
          {unpairedNoteClause(note, "trend")}
        </p>
      ))}
      {/* The "ignores the window above" half of this caption moved up into the
          All time heading, which now says it once for the whole half of the
          page rather than once per section. */}
      <p className="ins-fine">
        Always the last six pay periods — one period on its own is not a trend.
      </p>
    </Zone>
  );
}

/**
 * What you sold — upsold hours per pay period, plus the codes you sell most.
 *
 * ALL TIME, ignoring the window chips, for the same reason Trend does: six
 * periods is a trend and one week is a single bar.
 *
 * Rendered even when nothing has ever been marked, unlike every self-hiding
 * section above. Same call as Claims and recovery, made for the same reason —
 * Liem went looking for that card, found nothing, and could not tell whether the
 * feature existed or he had no data. An empty state that says how to fill it
 * answers both.
 */
function UpsellSection({
  points,
  codes,
  today,
}: {
  points: UpsellPeriodPoint[];
  codes: UpsoldCode[];
  today: string;
}) {
  const totalHours = points.reduce((s, p) => s + p.upsellHours, 0);
  const totalFlag = points.reduce((s, p) => s + p.flagHours, 0);
  const overallShare = totalFlag > 0 ? totalHours / totalFlag : null;

  if (totalHours === 0) {
    return (
      <Zone name="What you sold">
        <p className="ins-sub">
          Nothing marked as an upsell yet. Tap <b>Upsell</b> on an RO in your
          dashboard to add a line you sold, or tap the Upsell tag on any line
          already on a ticket.
        </p>
        <p className="ins-fine">
          Once a few are marked, this shows how much of the work you turn is
          work you found — the part of the job nobody else measures.
        </p>
      </Zone>
    );
  }

  // Scaled to the biggest share on show, not to 100%. A healthy upsell share is
  // a long way short of the whole ticket, so a 0–100% axis draws six near-empty
  // bars and hides the only thing the chart is for — whether it is rising.
  // Floored so one strong period can't make an ordinary one look like nothing.
  const peak = Math.max(0.1, ...points.map((p) => p.share ?? 0));

  return (
    <Zone
      name="What you sold"
      aside={<span className="ins-aside ins-good"><Hours value={fmtHours(totalHours)} /></span>}
    >
      <p className="ins-sub">
        <b>{fmtHours(totalHours)}h</b> upsold across these {points.length}{" "}
        {points.length === 1 ? "period" : "periods"}
        {overallShare !== null && (
          <> — {Math.round(overallShare * 100)}% of everything you flagged</>
        )}
        .
      </p>

      <ul className="ins-rows is-flush">
        {points.map((p) => {
          const share = p.share ?? 0;
          return (
            <li key={p.key}>
              <div className="ins-row-head">
                <span className="ins-row-name">
                  <span className="ins-row-code">{p.label}</span>
                  {p.end >= today && <span className="ins-row-why">In progress</span>}
                </span>
                <span className="ins-row-fig">
                  <Hours value={fmtHours(p.upsellHours)} />{" "}
                  <span className="ins-dim">
                    {p.share === null ? "—" : `${Math.round(share * 100)}%`}
                  </span>
                </span>
              </div>
              <div className="ins-track">
                {/* A period with no upsells keeps an empty track rather than a
                    stub: zero really is zero here, and a minimum-width bar
                    would claim a sale that didn't happen. */}
                <i className="is-good" style={{ width: `${(share / peak) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      {codes.length > 0 && (
        <div className="ins-subhead">
          <div className="ins-k">Most upsold</div>
          <ul className="ins-kv">
            {codes.map((c) => (
              <li key={c.opCodeId ?? `custom:${c.code}`}>
                <span className="ins-row-name">
                  <span className="ins-row-code">{c.code}</span>
                  {c.description && <span className="ins-dim">{c.description}</span>}
                </span>
                <span className="ins-row-fig">
                  <Hours value={fmtHours(c.hours)} />{" "}
                  <span className="ins-dim">×{c.count}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="ins-fine">
        Upsold hours are part of your flagged total, not extra on top of it.
      </p>
    </Zone>
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
      <Zone name="Claims and recovery">
        <p className="ins-lead">Nothing recovered yet.</p>
        <p className="ins-sub">
          When a period comes up short, track the claim on the Pay Period page
          and record what actually came back. This is where FRT tells you what
          it got back for you.
        </p>
      </Zone>
    );
  }

  return (
    <Zone
      name="Claims and recovery"
      aside={
        <span className="ins-aside ins-good">
          {lifetime.recoveredDollars !== null
            ? <span className="num">{withPt(fmtMoney(lifetime.recoveredDollars))}</span>
            : <Hours value={fmtHours(lifetime.recoveredHours)} />}
        </span>
      }
    >
      <dl className="spec">
        <div>
          <dt>Claims closed</dt>
          <dd className="num">{lifetime.closedCount}</dd>
        </div>
        <div>
          <dt>Got paid</dt>
          <dd className="num">{lifetime.winRate === null ? "—" : pct(lifetime.winRate)}</dd>
        </div>
        <div>
          <dt>Hours recovered</dt>
          <dd className="num">
            {lifetime.hourRecoveryRate === null ? "—" : pct(lifetime.hourRecoveryRate)}
          </dd>
        </div>
        <div>
          <dt>Recovered</dt>
          <dd className="num ins-good">
            {lifetime.recoveredDollars !== null
              ? withPt(fmtMoney(lifetime.recoveredDollars))
              : <Hours value={fmtHours(lifetime.recoveredHours)} />}
          </dd>
        </div>
      </dl>

      {lifetime.hourRecoveryRate !== null && lifetime.hourRecoveryRate > 1 && (
        <p className="ins-fine">
          Hours recovered is over 100% because a shop paid goodwill hours above
          what you claimed. The number is right.
        </p>
      )}

      {insights.map((i) => (
        <p key={i.id} className="ins-fine">
          <b>{i.betterLabel}</b> claims get paid {pct(i.betterRate)} of the time
          ({i.betterCount} closed) vs {pct(i.worseRate)} for <b>{i.worseLabel}</b>{" "}
          ({i.worseCount} closed).
        </p>
      ))}
      <p className="ins-fine">
        Lifetime figures across every claim you have ever raised.
      </p>
    </Zone>
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
  unpaid,
  hasSchedule = false,
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
  // The unpaid-time ledger, unscoped. Null pre-migration, same contract; the
  // leak board then shows only its op-code half, which is what it always was.
  unpaid: UnpaidTime[] | null;
  /**
   * Does the tech have a work schedule at all? Only the trend caption reads it,
   * and only to avoid claiming a shift is "still in progress" for someone who
   * has no shifts. Defaults to false — the conservative answer, and the one
   * this page effectively assumed before the flag existed.
   */
  hasSchedule?: boolean;
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

  // Scoped with the SAME range object and the same inclusive comparison as
  // scopedEntries. A second filter here is how the leak board and the rest of
  // the page would end up describing different windows.
  const scopedUnpaid = useMemo(() => {
    const rows = unpaid ?? [];
    return range === null
      ? rows
      : rows.filter((u) => u.date >= range.start && u.date <= range.end);
  }, [unpaid, range]);

  // buildUnpaidSummary is the app's one flattening of unpaid time — the same
  // function the Pay Period "Every unpaid record" list and the dispute pack
  // read. The leak board takes its output rather than re-deriving the ledger,
  // so the two surfaces cannot report different totals for one period. Rates
  // are deliberately not passed: the board is an hours board, and the dollar
  // figures would be computed and thrown away.
  const unpaidSummary = useMemo(
    () =>
      buildUnpaidSummary({
        entries: scopedEntries,
        unpaid: scopedUnpaid,
        library,
      }),
    [scopedEntries, scopedUnpaid, library],
  );

  const opCodes = useMemo(
    () => opCodePerformance(scopedEntries, library),
    [scopedEntries, library],
  );
  const sortedOpCodes = useMemo(
    () => sortOpCodes(opCodes, sortCol, sortDir),
    [opCodes, sortCol, sortDir],
  );
  // Both derived from the SAME rows the table renders, so the leaderboard and
  // the table can never disagree about one op code's hours. The leak board
  // additionally takes the ledger half, which has no op code and therefore no
  // row in either — see leakBoard.
  const leaks = useMemo(
    () => leakBoard(opCodes, unpaidSummary.lines),
    [opCodes, unpaidSummary],
  );
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
    // `today` is not optional in practice: without it periodTrend cannot tell a
    // day that is still running from one that was never measurable, and the
    // caption under the chart goes back to giving one answer for both.
    () =>
      periodTrend(entries, denomByDay, {
        splitDay,
        periodOverrides,
        today,
        // Without this a tech with NO schedule is told a today-dated entry is
        // "still in progress" here while /pay-period calls the same day
        // unmeasurable. See isInProgressDay's fourth argument.
        hasSchedule,
      }),
    [entries, denomByDay, splitDay, periodOverrides, today, hasSchedule],
  );

  // Deliberately NOT built from `trend`, which carries PAIRED flag hours (its
  // numbers are the numerator of an efficiency percentage, so days with no
  // denominator are excluded). Upsold work on an unclocked Saturday is still
  // upsold — dividing by the paired total would report shares above 100%.
  const upsells = useMemo(
    () => upsellByPeriod(entries, { splitDay, periodOverrides }),
    [entries, splitDay, periodOverrides],
  );
  const upsoldCodes = useMemo(
    () => topUpsoldCodes(entries, library),
    [entries, library],
  );

  const lifetime = disputes ? lifetimeRecovery(disputes) : null;
  const insights = disputes ? outcomeInsights(disputes) : [];
  const hasWorkedDays = weekdays.some((w) => w.efficiency !== null);

  // Two different questions, and conflating them left an empty window showing a
  // lone Trend chart with nothing explaining why everything else vanished.
  //   hasWindowContent — do the WINDOWED sections have anything to draw?
  //   hasAnyHistory    — is there anything in this account at all?
  // Trend and Recovery span all history, so they can't answer the first one.
  // Ledger rows count as content. A window whose only record is "3.5h waiting
  // on parts" has no entries and no worked days, and without this it rendered
  // "No work recorded in this pay period" over hours the tech typed in himself
  // — the same hiding bug one level up.
  const hasWindowContent =
    opCodes.length > 0 || hasWorkedDays || leaks.leaks.length > 0;
  const hasAnyHistory =
    entries.length > 0 ||
    Object.keys(denomByDay).length > 0 ||
    (unpaid !== null && unpaid.length > 0) ||
    (lifetime !== null && lifetime.closedCount > 0);

  const chipRow = (
    <div className="ins-ctl">
      <span className="ins-k">Window</span>
      <div className="seg" role="group" aria-label="Window">
        {CHIPS.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            aria-pressed={filter === chip.kind}
            onClick={() => setFilter(chip.kind)}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (!hasAnyHistory) {
    return (
      <div>
        {chipRow}
        <Zone name="Insights" className="ins-empty">
          <EmptyState
            icon={<Lightbulb size={22} />}
            title="Not enough data yet"
            description="Log your clocked hours and put a few jobs on the timer. Once the app knows how long a day was and how long a job took, this page can tell you which work is costing you."
          />
        </Zone>
      </div>
    );
  }

  // The headline panel's figures, derived from the same aggregates the
  // sections below draw, so the top of the page can never disagree with the
  // evidence under it.
  const bestDay = weekdays.reduce<WeekdayEfficiency | null>(
    (acc, r) =>
      r.efficiency === null ? acc : acc === null || r.efficiency > acc.efficiency! ? r : acc,
    null,
  );
  const verdictTrend = (() => {
    // Finished periods with a printable figure only — the same rule as the
    // Trend caption (see TrendSection).
    const complete = trend
      .filter((p) => p.end < today)
      .map((p) => ({ p, d: trendEfficiencyDisplay(p) }))
      .filter((x) => x.d.kind === "shown");
    if (complete.length === 0) return null;
    const to = complete[complete.length - 1];
    const from = complete.length >= 2 ? complete[complete.length - 2] : null;
    return {
      to: to.p,
      toPct: (to.d as { pct: number }).pct,
      fromPct: from ? (from.d as { pct: number }).pct : null,
    };
  })();
  const soldTotal = upsells.reduce((s, p) => s + p.upsellHours, 0);
  const soldFlag = upsells.reduce((s, p) => s + p.flagHours, 0);
  const soldShare = soldTotal > 0 && soldFlag > 0 ? soldTotal / soldFlag : null;

  return (
    <div>
      {/* Conclusion, then the control that scopes it, then the evidence. */}
      {hasWindowContent && (
        <FindingLede
          board={leaks}
          bestDay={bestDay}
          trend={verdictTrend}
          soldShare={soldShare}
        />
      )}
      {chipRow}

      {hasWindowContent ? (
        <>
          {leaks.leaks.length > 0 && <LeakSection board={leaks} />}
          {opCodes.length > 0 && (
            <TimeGoesSection
              rows={sortedOpCodes}
              sortCol={sortCol}
              sortDir={sortDir}
              onSort={handleSort}
            />
          )}
          {/* the two short ones share a row on desktop */}
          <div className="ins-grid">
            {hasWorkedDays && (
              <BestDaysSection
                rows={weekdays}
                sort={weekdaySort}
                onSort={setWeekdaySort}
              />
            )}
            {gains.length > 0 && <GainSection gains={gains} />}
          </div>
        </>
      ) : (
        <Zone name="This window">
          <p className="ins-sub">
            No work recorded in this {filter === "period" ? "pay period" : filter}.
            Pick a wider window above — the trend below still covers your whole
            history.
          </p>
        </Zone>
      )}

      {/* The window chips stop here, and the page says so structurally instead
          of apologising for it in a caption under each section. */}
      {(trend.length > 0 || lifetime !== null || mix.days.length > 0) && (
        <div className="ins-alltime">
          <h2>All time</h2>
          <span>Ignores the window above</span>
        </div>
      )}
      {/* Same order as before, read left-to-right then down on desktop: the
          mix pair, the job-time pair, then Trend beside What you sold, then
          Claims. Each pair is two zones the old page stacked. */}
      <div className="ins-grid">
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
        <UpsellSection points={upsells} codes={upsoldCodes} today={today} />
        {/* Gated only on the migration having landed — the section handles
            "nothing recovered yet" itself. */}
        {lifetime !== null && (
          <RecoverySection lifetime={lifetime} insights={insights} />
        )}
      </div>
    </div>
  );
}
