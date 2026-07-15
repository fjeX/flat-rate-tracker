// Work-day logging streak — heat gauge (design 1C, docs/gamification.md).
// Server component: everything is precomputed, the gauge is pure CSS.
import { Flame, Snowflake } from "lucide-react";
import { EntranceGrid } from "@/components/ui/EntranceGrid";
import { gaugeMarks, type StreakResult } from "@/lib/streak";

// Keep marks and fill off the rounded end caps.
const EDGE_PCT = 2;
function toPct(fraction: number): number {
  return EDGE_PCT + Math.min(Math.max(fraction, 0), 1) * (100 - 2 * EDGE_PCT);
}

export function StreakCard({ streak }: { streak: StreakResult }) {
  const marks = gaugeMarks(streak.current);
  const max = marks[marks.length - 1];
  const lit = streak.current > 0;
  const toNext =
    streak.nextMilestone !== null ? streak.nextMilestone - streak.current : null;

  let subLine: React.ReactNode;
  if (!lit && streak.longest === 0) {
    subLine = <>Log an RO to light it — days off never count against you.</>;
  } else if (!streak.todayLogged) {
    subLine = (
      <>
        Log today to make it <b>{streak.current + 1}</b>
        {" · "}
        <span className="gami-heat-frozen">
          <Snowflake size={12} aria-hidden="true" /> days off freeze automatically
        </span>
      </>
    );
  } else if (toNext !== null) {
    subLine = (
      <>
        {toNext} more work {toNext === 1 ? "day" : "days"} to <b>{streak.nextMilestone}</b>
        {" · "}
        <span className="gami-heat-frozen">
          <Snowflake size={12} aria-hidden="true" /> days off frozen
        </span>
      </>
    );
  } else {
    subLine = <>Every milestone on the board cleared. Keep going.</>;
  }

  return (
    <EntranceGrid className="card padded gami-heat" animationName="pace-grow">
      <div className="gami-heat-top">
        <div>
          <div className="gami-heat-label">Logging streak</div>
          <div className="gami-heat-num tabular">
            {streak.current}
            <span className="unit"> work {streak.current === 1 ? "day" : "days"}</span>
          </div>
        </div>
        <div className="gami-heat-side">
          <Flame
            size={26}
            className={`gami-heat-flame${lit ? "" : " cold"}`}
            aria-hidden="true"
          />
          {streak.longest > streak.current && (
            <span className="badge badge-neutral mono">BEST {streak.longest}</span>
          )}
        </div>
      </div>
      <div className="gami-heat-track">
        <div
          className="gami-heat-fill"
          style={{ width: `${lit ? toPct(streak.current / max) : 0}%` }}
        />
      </div>
      <div className="gami-heat-marks">
        {marks.map((m) => (
          <span
            key={m}
            className={`gami-heat-mark${streak.current >= m ? " hit" : ""}`}
            style={{ left: `${toPct(m / max)}%` }}
          >
            {m}
          </span>
        ))}
      </div>
      <div className="gami-heat-sub">{subLine}</div>
    </EntranceGrid>
  );
}
