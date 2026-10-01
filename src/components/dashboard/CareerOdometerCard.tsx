// Career odometer — quiet lifetime number over a milestone road (chosen
// 2A+2C hybrid, docs/gamification.md). Counts documented-in-FRT flag hours
// only; the road pins are earned-once (a correction can lower the number,
// never un-ring a bell). One row of the "Streak, career, snapshot" zone.
import { RollingNumber } from "@/components/ui/RollingNumber";
import { withPt } from "@/components/ui/Figure";
import {
  careerRoadPosition,
  careerRoadStops,
  nextCareerMilestone,
} from "@/lib/career";
import { fmtHours, fmtHoursGrouped } from "@/lib/format";
import { Track } from "./Track";

function markLabel(threshold: number): string {
  return threshold >= 1000 ? `${threshold / 1000}k` : String(threshold);
}

export function CareerOdometerCard({
  careerTotal,
  careerMilestones,
  weekDelta,
}: {
  careerTotal: number;
  careerMilestones: number[];
  weekDelta: number;
}) {
  const stops = careerRoadStops();
  const pinX = careerRoadPosition(careerTotal);
  const next = nextCareerMilestone(careerTotal);
  const hit = new Set(careerMilestones);

  // Grouped, because a lifetime total is the one hours figure in the app that
  // routinely reaches four digits. Not a private Intl call: that has no
  // sub-resolution floor, so a career of one 0.02h line read "0.0" — while the
  // legend below already used fmtHours. One row, one formatter.
  const valueText = fmtHoursGrouped(careerTotal);

  return (
    <div className="rec" data-testid="career-row">
      <div className="rec-top">
        <div className="rec-name">
          <h3>Career hours flagged</h3>
        </div>
        <span className="num rec-val">
          <RollingNumber value={valueText}>
            <span className="unit">hrs</span>
          </RollingNumber>
        </span>
      </div>
      <Track
        fill={pinX * 100}
        label={`${valueText} hours. Markers at ${stops.map((s) => markLabel(s.threshold)).join(", ")}.`}
        ticks={stops.map((s, i) => ({
          key: s.threshold,
          label: markLabel(s.threshold),
          left: s.x * 100,
          cls: [
            hit.has(s.threshold) ? "done" : "",
            i === stops.length - 1 ? "last" : "",
            i === 0 ? "first" : "",
          ]
            .filter(Boolean)
            .join(" "),
        }))}
      />
      <p className="rec-legend">
        {hit.size > 0 && (
          <>
            <b className="num">{hit.size}</b> milestone{hit.size === 1 ? "" : "s"} down.{" "}
          </>
        )}
        {next !== null ? (
          <>
            <b className="num">{withPt(fmtHours(next - careerTotal))} hrs</b> to the {markLabel(next)} marker.
          </>
        ) : (
          <>Every marker on the road is behind you.</>
        )}
        {/* "last 7 days", never "this week": this delta is a rolling window ending
            today (gamification.ts), while the dashboard's "This Week" row is a
            calendar week whose start day the tech configures. Same words, two
            different windows, on one screen — so this one doesn't use the word. */}
        {weekDelta > 0 && (
          <>
            {" "}
            <span className="rec-delta">
              <span className="num">+{withPt(fmtHours(weekDelta))}</span> last 7 days
            </span>
            .
          </>
        )}
      </p>
    </div>
  );
}
