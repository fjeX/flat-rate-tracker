import { fmtHours } from "@/lib/stats";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { Zone } from "@/components/ui/Zone";

export type PaceTick = { key: string; label: string; left: number; cls: string };

/**
 * Tick labels under the pace track: 0, the percent of goal reached (at the end
 * of the fill), and the goal. The three can collide near the ends, so:
 *   - fill in the first 12%: the "0" goes, the percent takes its place
 *   - fill in the last 12%: the percent folds into the goal label
 * so every number is still printed exactly once.
 */
export function paceTicks(actualFrac: number, goalHours: number): PaceTick[] {
  const pct = Math.round(actualFrac * 100);
  const fill = Math.min(actualFrac, 1) * 100;
  const goal = String(goalHours);
  if (fill < 12) {
    return [
      { key: "pct", label: `${pct}%`, left: 0, cls: "done first" },
      { key: "goal", label: goal, left: 100, cls: "last" },
    ];
  }
  if (fill > 88) {
    return [
      { key: "zero", label: "0", left: 0, cls: "first" },
      { key: "goal", label: `${goal} · ${pct}%`, left: 100, cls: "last done" },
    ];
  }
  return [
    { key: "zero", label: "0", left: 0, cls: "first" },
    { key: "pct", label: `${pct}%`, left: fill, cls: "done" },
    { key: "goal", label: goal, left: 100, cls: "last" },
  ];
}

/**
 * Pay Period Pace: this period's flag hours against the goal, on a track with
 * a today marker at how far through the period it is. The words under it are
 * the projection, computed by the page.
 */
export function PaceZone({
  flagHours,
  goalHours,
  hasGoal,
  actualFrac,
  paceTarget,
  daysLeft,
  periodLabel,
  forecastLine,
  requiredLine,
  dayText,
}: {
  flagHours: number;
  goalHours: number;
  hasGoal: boolean;
  /** True fraction of goal (can exceed 1). The fill clamps; every number is real. */
  actualFrac: number;
  /** How far through the period today is, 0–1. */
  paceTarget: number;
  daysLeft: number;
  periodLabel: string;
  forecastLine: string;
  requiredLine: string;
  /**
   * "Day 9 / 15". Only passed when the period's efficiency is withheld: that is
   * the one time the old pace card's foot printed it instead of the percentage.
   */
  dayText: string | null;
}) {
  const fill = Math.min(actualFrac, 1) * 100;
  const today = Math.min(Math.max(paceTarget, 0), 1) * 100;
  const label = hasGoal
    ? `${fmtHours(flagHours)} of ${goalHours} flag hours, ${Math.round(actualFrac * 100)} percent of goal. Today is ${Math.round(today)} percent through the period.`
    : `${fmtHours(flagHours)} flag hours this period. No goal set.`;
  return (
    <Zone id="z-pace" name="Pay Period Pace" link={{ href: "/pay-period", label: "Pay Period" }}>
      <div className="bigline">
        <b className="num">
          <RollingNumber value={fmtHours(flagHours)} />
        </b>
        <span>flag hrs</span>
        <span className="end fine">
          {periodLabel}
          {dayText ? ` · ${dayText}` : ""} · {daysLeft} {daysLeft === 1 ? "day" : "days"} left
        </span>
      </div>
      <div className={`track${hasGoal ? " has-labels" : ""}`} role="img" aria-label={label}>
        <i className="fill" style={{ width: `${fill}%` }} />
        {/* The label of a marker sits to its left ("pre") so a marker near the
            right end can't push its text off the track. */}
        <i className="mk now pre" style={{ left: `${today}%` }}>
          <span>Today</span>
        </i>
        {hasGoal && (
          <i className="mk end" style={{ left: "100%" }}>
            <span>
              Goal <span className="num">{goalHours}</span>
            </span>
          </i>
        )}
      </div>
      {hasGoal && (
        <div className="ticks" aria-hidden="true">
          {paceTicks(actualFrac, goalHours).map((t) => (
            <span key={t.key} className={t.cls} style={{ left: `${t.left}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      )}
      {hasGoal && (
        <div className="pace-words">
          <p className="lead">{forecastLine}</p>
          {requiredLine && <p className="sub">{requiredLine}</p>}
        </div>
      )}
    </Zone>
  );
}
