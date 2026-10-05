"use client";

// Efficiency — the page's all-time figure, the graph of how it got there, and
// what generates it.
//
// Replaced the six-bar Trend zone (Liem, 2026-10-04: efficiency was only shown
// in passing, and "overall" was nowhere). Every rule Trend had is kept, because
// each was an escalation once:
//   - bars are gated through trendEfficiencyDisplay, so a withheld period prints
//     "—" and draws a stub, never a hollow percentage;
//   - an unfinished or withheld period never sets the scale;
//   - the change caption compares the last two FINISHED, printable periods;
//   - hours on days with no length are stated, by reason, never dropped.
// What is new: every period instead of the last six, a line for the overall
// figure as it stood after each period, and the breakdown under the graph.
import { withPt } from "@/components/ui/Figure";
import { Zone } from "@/components/ui/Zone";
import {
  fmtHours,
  fmtPct,
  unpairedNoteClause,
  unpairedNotes,
  type UnpairedNote,
} from "@/lib/stats";
import {
  trendEfficiencyDisplay,
  type EfficiencyBreakdown,
  type PeriodTrendPoint,
  type RunningEfficiencyPoint,
} from "@/lib/insights";
import { OriginTag } from "@/components/insights/OriginTag";

/**
 * The tallest bar, as a percentage of the plot's height. The ceiling bar
 * reaches this; the value labels sit in the remaining headroom. Exported for
 * the section's test, which asserts bar heights against it.
 */
export const TREND_BAR_MAX = 86;

/** Above this many periods every bar keeps its label in the DOM (screen
 * readers, tests) but only the current one is drawn: thirty "128%" labels
 * side by side on a phone is noise. */
const DENSE_AFTER = 12;

function pts(n: number): string {
  return `${Math.round(n)}`;
}

export function EfficiencySection({
  points,
  running,
  breakdown,
  today,
}: {
  points: PeriodTrendPoint[];
  running: RunningEfficiencyPoint[];
  breakdown: EfficiencyBreakdown | null;
  today: string;
}) {
  const last = points[points.length - 1];
  const overall = running[running.length - 1]?.display ?? { kind: "none" as const };
  const overallPct = overall.kind === "shown" ? overall.pct : null;

  // FINISHED periods only for anything comparative. A period two days old has
  // two days of hours in it; the in-progress bar still draws, labelled.
  const complete = points.filter((p) => p.end < today);

  // The printable percentage per bar, keyed so the label, the height, the axis
  // and the caption cannot answer differently.
  const shownPct = new Map<string, number | null>(
    points.map((p) => {
      const d = trendEfficiencyDisplay(p);
      return [p.key, d.kind === "shown" ? d.pct : null];
    }),
  );
  const measured = (p: PeriodTrendPoint) => shownPct.get(p.key) != null;

  // The axis: finished, printable bars only (an unfinished period one day in
  // read 1565% once and squashed every real bar), the overall line too since
  // it shares the plot, floored at 100 so par is always on the chart.
  const completeMeasured = complete.filter(measured);
  const scaleSource =
    completeMeasured.length > 0 ? completeMeasured : points.filter(measured);
  // The line's points after an UNFINISHED period clip rather than scale, the
  // same rule as the bars: one day of a new period can still swing it.
  const runningPcts = running
    .filter((r, i) => points[i] && points[i].end < today)
    .map((r) => r.pct)
    .filter((v): v is number => v !== null);
  const ceiling = Math.max(
    100,
    ...scaleSource.map((p) => shownPct.get(p.key)!),
    ...runningPcts,
  );
  const parOffset = (100 / ceiling) * TREND_BAR_MAX;
  const dense = points.length > DENSE_AFTER;
  // Axis labels: every period when there's room, otherwise about six evenly
  // spaced plus the current one.
  const labelEvery = dense ? Math.ceil(points.length / 6) : 1;

  // The overall line, in the plot's own coordinates (0–100 both ways). Columns
  // have no gap, so column i's centre is exactly (i + 0.5) / n. A withheld
  // point BREAKS the line rather than being bridged: a straight segment across
  // a stretch with no printable figure would draw a value nobody measured.
  const n = points.length;
  const segments: string[][] = [[]];
  running.forEach((r, i) => {
    if (r.pct === null) {
      if (segments[segments.length - 1].length > 0) segments.push([]);
      return;
    }
    segments[segments.length - 1].push(
      `${((i + 0.5) / n) * 100},${100 - (Math.min(r.pct, ceiling) / ceiling) * TREND_BAR_MAX}`,
    );
  });
  const lines = segments.filter((s) => s.length >= 2);

  // Hours in no percentage on this page, by reason (lib/stats words them, the
  // same clause /pay-period prints).
  const notes: (UnpairedNote & { labels: string[] })[] = [];
  for (const point of points) {
    if (point.unpairedFlagHours <= 0) continue;
    for (const note of unpairedNotes(point.unpairedByReason, {
      flagHours: point.unpairedFlagHours,
      days: point.unpairedDays,
    })) {
      const found = notes.find((x) => x.kind === note.kind);
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
  const fromPct = deltaFrom ? (shownPct.get(deltaFrom.key) ?? null) : null;
  const toPct = deltaTo ? (shownPct.get(deltaTo.key) ?? null) : null;
  const delta = toPct != null && fromPct != null ? toPct - fromPct : null;

  return (
    <Zone
      name="Efficiency"
      className="ins-eff"
      aside={
        overallPct !== null ? (
          <span className="ins-aside">
            <span className="num">{withPt(fmtPct(overallPct))}</span> overall
          </span>
        ) : undefined
      }
    >
      <OverallLead display={overall} breakdown={breakdown} />

      <div className="ins-trend">
        <div className={`ins-trend-plot ins-eff-plot${dense ? " is-dense" : ""}`}>
          <div className="ins-par" style={{ bottom: `${parOffset}%` }} aria-hidden="true">
            <span>100%</span>
          </div>
          {points.map((point) => {
            const pct = shownPct.get(point.key) ?? null;
            // A withheld bar still draws (the hours in it are real) but claims
            // no height: its height IS its percentage, and there isn't one.
            const value = pct ?? 0;
            const clipped = pct !== null && value > ceiling;
            const height = Math.max(4, (Math.min(value, ceiling) / ceiling) * TREND_BAR_MAX);
            const inProgress = point.end >= today;
            return (
              <div
                key={point.key}
                className={`ins-trend-col${point === last ? " is-current" : ""}`}
                title={`${point.label}: ${fmtPct(pct)}`}
              >
                <span className="trend-val">{fmtPct(pct)}</span>
                <div
                  className={[
                    "trend-bar",
                    point === last && "is-current",
                    inProgress && "is-running",
                    clipped && "is-clipped",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
          {lines.length > 0 && (
            <svg
              className="ins-eff-line"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {lines.map((seg) => (
                <polyline key={seg[0]} points={seg.join(" ")} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
          )}
        </div>
        <div className="ins-trend-x">
          {points.map((point, i) => {
            const isLast = point === last;
            // A periodic label too close to the current one would overprint
            // it (dense labels don't wrap), so the current one wins.
            const show =
              isLast || (i % labelEvery === 0 && n - 1 - i >= Math.ceil(labelEvery / 2));
            return (
              <span key={point.key} className={isLast ? "is-current" : undefined}>
                {show ? point.label : ""}
                {point.end >= today && <b>In progress</b>}
              </span>
            );
          })}
        </div>
        <div className="ins-legend">
          <span><i aria-hidden="true" /> Each pay period</span>
          {lines.length > 0 && (
            <span><i className="is-line" aria-hidden="true" /> Overall, as it stood</span>
          )}
        </div>
      </div>

      {/* Both figures, stated plainly — "up 42 points" was correct and useless. */}
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
      <p className="ins-fine">
        Every pay period you&rsquo;ve logged. The line is your overall
        efficiency as it stood at the end of each one, so the last point is the
        figure above.
      </p>

      {overallPct !== null && breakdown && breakdown.flagHours > 0 && (
        <Breakdown pct={overallPct} breakdown={breakdown} />
      )}

      {/* The table twin: every bar's figure, readable without the picture. */}
      <table className="sr-only">
        <caption>Efficiency by pay period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Efficiency</th>
            <th scope="col">Overall after it</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>{fmtPct(shownPct.get(p.key) ?? null)}</td>
              <td>{fmtPct(running[i]?.pct ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Zone>
  );
}

/** The sentence under the zone head: the figure in shop terms, or why not. */
function OverallLead({
  display,
  breakdown,
}: {
  display: RunningEfficiencyPoint["display"];
  breakdown: EfficiencyBreakdown | null;
}) {
  switch (display.kind) {
    case "shown":
      return (
        <p className="ins-sub">
          <b>{fmtPct(display.pct)} overall.</b> Every hour you&rsquo;ve been at
          the shop has paid <b>{(display.pct / 100).toFixed(2)}h</b> of flag
          {breakdown && (
            <>
              {" "}
              ({fmtHours(breakdown.flagHours)}h flagged over{" "}
              {fmtHours(breakdown.shopHours)}h at the shop)
            </>
          )}
          .
        </p>
      );
    case "all_excluded":
      return (
        <p className="ins-sub">
          <b>No overall figure yet.</b> All {fmtHours(display.excludedHours)}h
          you&rsquo;ve flagged fell on days the app doesn&rsquo;t know the
          length of. Clock your hours, or set a schedule, and it fills in.
        </p>
      );
    case "mostly_excluded":
      return (
        <p className="ins-sub">
          <b>Overall figure withheld.</b> {fmtHours(display.excludedHours)}h of
          the {fmtHours(display.totalHours)}h you&rsquo;ve flagged fell on days
          the app doesn&rsquo;t know the length of, so a percentage would leave
          out most of your work.
        </p>
      );
    case "none":
      return (
        <p className="ins-sub">
          No overall figure yet. Clock your hours, or set a schedule, so the
          app knows how long your days are.
        </p>
      );
  }
}

/**
 * What makes the figure. Efficiency is flag ÷ shop hours, so each flagged hour
 * on a counted day is worth the same number of points, and the rows add up to
 * the headline: shop hours below, the codes that filled them above.
 */
function Breakdown({ pct, breakdown: b }: { pct: number; breakdown: EfficiencyBreakdown }) {
  const biggest = b.top[0]?.points ?? 0;
  const bar = (p: number) => (biggest > 0 ? Math.max(2, (p / biggest) * 100) : 0);
  return (
    <div className="ins-subhead ins-eff-why">
      <div className="ins-k">What makes {fmtPct(pct)}</div>

      <div className="ins-eff-eq" aria-label={`${fmtHours(b.flagHours)} hours flagged divided by ${fmtHours(b.shopHours)} hours at the shop equals ${fmtPct(pct)}`}>
        <div>
          <span className="num">{withPt(fmtHours(b.flagHours))}<span className="unit">h</span></span>
          <small>flagged</small>
        </div>
        <span className="ins-eff-op" aria-hidden="true">÷</span>
        <div>
          <span className="num">{withPt(fmtHours(b.shopHours))}<span className="unit">h</span></span>
          <small>at the shop</small>
        </div>
        <span className="ins-eff-op" aria-hidden="true">=</span>
        <div>
          <span className="num">{withPt(fmtPct(pct))}</span>
          <small>overall</small>
        </div>
      </div>
      <p className="ins-fine">
        At the shop:{" "}
        {b.clockedDays > 0 && (
          <>
            <b>{fmtHours(b.clockedHours)}h</b> clocked over {b.clockedDays}{" "}
            {b.clockedDays === 1 ? "day" : "days"}
          </>
        )}
        {b.clockedDays > 0 && b.scheduledDays > 0 && " · "}
        {b.scheduledDays > 0 && (
          <>
            <b>{fmtHours(b.scheduledHours)}h</b> from your schedule over{" "}
            {b.scheduledDays} {b.scheduledDays === 1 ? "day" : "days"} you
            didn&rsquo;t clock
          </>
        )}
        .
      </p>

      <div className="ins-k ins-eff-k2">Where the points come from</div>
      <ol className="ins-rows is-flush ins-eff-rows">
        {b.top.map((row) => (
          <li key={row.key}>
            <div className="ins-row-head">
              <span className="ins-row-name">
                <span className="ins-row-code">{row.code}</span>
                <OriginTag row={row} />
                {row.description && <span className="ins-row-why">{row.description}</span>}
              </span>
              <span className="ins-row-fig">
                <span className="num">+{pts(row.points)}</span>
                <span className="unit">pts</span>{" "}
                <span className="ins-dim">{fmtHours(row.hours)}h</span>
              </span>
            </div>
            <div className="ins-track">
              <i style={{ width: `${bar(row.points)}%` }} />
            </div>
          </li>
        ))}
        {b.rest.hours > 0 && (
          <li>
            <div className="ins-row-head">
              <span className="ins-row-name">
                <span className="ins-row-code">Everything else</span>
                <span className="ins-row-why">
                  {b.rest.codes > 0
                    ? `${b.rest.codes} more ${b.rest.codes === 1 ? "code" : "codes"}`
                    : "lines with no code"}
                </span>
              </span>
              <span className="ins-row-fig">
                <span className="num">+{pts(b.rest.points)}</span>
                <span className="unit">pts</span>{" "}
                <span className="ins-dim">{fmtHours(b.rest.hours)}h</span>
              </span>
            </div>
            <div className="ins-track">
              <i className="is-dim" style={{ width: `${bar(b.rest.points)}%` }} />
            </div>
          </li>
        )}
      </ol>
      {b.upsell.hours > 0 && (
        <p className="ins-fine">
          <b>{fmtHours(b.upsell.hours)}h</b> of that is work you sold, worth{" "}
          <b>{pts(b.upsell.points)} points</b> of your {fmtPct(pct)}.
        </p>
      )}
      <p className="ins-fine">
        A point is one percent of efficiency. Every flagged hour is worth the
        same number of points (100 ÷ {fmtHours(b.shopHours)}h at the shop), so
        a code&rsquo;s points are just its share of your flag. Rounded, so the
        rows can add up a point off the total. Only days the app knows the
        length of are counted.
      </p>
    </div>
  );
}
