// Work-day logging streak (design 1C, docs/gamification.md). One row of the
// "Streak, career, snapshot" zone: the count, a track marked at the next
// milestones, and one line about what logging today does.
// Server component: everything is precomputed.
import { Badge } from "@/components/ui/Badge";
import { gaugeMarks, type StreakResult } from "@/lib/streak";
import { Track } from "./Track";

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
        Log today to make it <b className="num">{streak.current + 1}</b>
        {" · "}days off freeze automatically
      </>
    );
  } else if (toNext !== null) {
    subLine = (
      <>
        <span className="num">{toNext}</span> more work {toNext === 1 ? "day" : "days"} to{" "}
        <b className="num">{streak.nextMilestone}</b>
        {" · "}days off frozen
      </>
    );
  } else {
    subLine = <>Every milestone on the board cleared. Keep going.</>;
  }

  const fill = lit ? (streak.current / max) * 100 : 0;

  return (
    <div className="rec" data-testid="streak-row">
      <div className="rec-top">
        <div className="rec-name">
          <h3>Logging streak</h3>
          {streak.longest > streak.current && (
            <Badge>
              Best <span className="num">{streak.longest}</span>
            </Badge>
          )}
        </div>
        <span className="num rec-val">
          {streak.current}
          <span className="unit">work {streak.current === 1 ? "day" : "days"}</span>
        </span>
      </div>
      <Track
        fill={fill}
        label={`${streak.current} work ${streak.current === 1 ? "day" : "days"}. Markers at ${marks.join(", ")}.`}
        ticks={marks.map((m, i) => ({
          key: m,
          label: String(m),
          left: (m / max) * 100,
          cls: [
            streak.current >= m ? "done" : "",
            i === marks.length - 1 ? "last" : "",
            (m / max) * 100 < 8 ? "first" : "",
          ]
            .filter(Boolean)
            .join(" "),
        }))}
      />
      <p>{subLine}</p>
    </div>
  );
}
