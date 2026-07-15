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
import { fmtHours } from "@/lib/stats";

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

  const valueText = careerTotal.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

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
