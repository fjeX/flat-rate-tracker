// Career odometer — quiet lifetime number over a milestone road (chosen
// 2A+2C hybrid, docs/gamification.md). Counts documented-in-FRT flag hours
// only; the road pins are earned-once (a correction can lower the number,
// never un-ring a bell).
import { TrendingUp } from "lucide-react";
import { EntranceGrid } from "@/components/ui/EntranceGrid";
import { RollingNumber } from "@/components/ui/RollingNumber";
import {
  careerRoadPosition,
  careerRoadStops,
  nextCareerMilestone,
} from "@/lib/career";
import { fmtHours, fmtHoursGrouped } from "@/lib/format";

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
  // legend below already used fmtHours. One card, one formatter.
  const valueText = fmtHoursGrouped(careerTotal);

  return (
    <EntranceGrid className="card padded gami-odo" animationName="pace-grow">
      <div className="gami-heat-label">Career hours flagged</div>
      <div className="gami-odo-val">
        <RollingNumber value={valueText}>
          <span className="unit">hrs</span>
        </RollingNumber>
      </div>
      {weekDelta > 0 && (
        <div className="gami-odo-delta tabular">
          <TrendingUp size={12} aria-hidden="true" /> +{fmtHours(weekDelta)} this week
        </div>
      )}
      <div className="gami-road">
        <div className="gami-road-fill" style={{ width: `${pinX * 100}%` }} />
        {stops.map((s) => (
          <span
            key={s.threshold}
            className={`gami-road-stop${hit.has(s.threshold) ? " done" : ""}`}
            style={{ left: `${s.x * 100}%` }}
          >
            <span className="pin" />
            <span className="t">{markLabel(s.threshold)}</span>
          </span>
        ))}
        <span className="gami-road-stop here" style={{ left: `${pinX * 100}%` }}>
          <span className="pin" />
        </span>
      </div>
      <div className="gami-road-legend tabular">
        {hit.size > 0 && (
          <>
            <b>{hit.size}</b> milestone{hit.size === 1 ? "" : "s"} down.{" "}
          </>
        )}
        {next !== null ? (
          <>
            <b>{fmtHours(next - careerTotal)} hrs</b> to the {markLabel(next)} marker.
          </>
        ) : (
          <>Every marker on the road is behind you.</>
        )}
      </div>
    </EntranceGrid>
  );
}
