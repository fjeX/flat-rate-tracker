// Dashboard entry point for portfolio snapshots: progress to the next
// unlock, plus the latest build sheet (docs/gamification.md, design 8B).
// The last row of the "Streak, career, snapshot" zone.
import Link from "next/link";
import type { PortfolioSnapshot } from "@/lib/types";
import { SnapshotSheet } from "@/components/snapshots/SnapshotSheet";
import { Track } from "./Track";
import { DashIcon } from "./DashIcon";

export function SnapshotsCard({
  snapshots,
  roCount,
  nextSnapshotAt,
  timeZone,
}: {
  snapshots: PortfolioSnapshot[];
  roCount: number;
  nextSnapshotAt: number;
  timeZone?: string;
}) {
  const latest = snapshots[0] ?? null;
  const prevThreshold = latest?.roThreshold ?? 0;
  // Progress within the current unlock window, not from zero — the bar
  // resets after each unlock so there's always visible motion.
  const span = Math.max(nextSnapshotAt - prevThreshold, 1);
  const frac = Math.min(Math.max((roCount - prevThreshold) / span, 0), 1);
  const toGo = Math.max(nextSnapshotAt - roCount, 0);

  return (
    <div className="rec" data-testid="snapshots-row">
      <div className="rec-top">
        <div className="rec-name">
          <h3>Portfolio snapshots</h3>
        </div>
        <span className="num rec-val">
          {roCount}
          <span className="unit">/ {nextSnapshotAt} ROs</span>
        </span>
      </div>
      <Track
        fill={frac * 100}
        endMark
        label={`${roCount} of ${nextSnapshotAt} repair orders`}
      />
      <p className="rec-snap">
        <b>{latest ? `Next: Snapshot #${latest.seq + 1}.` : "Your first snapshot."}</b> Log{" "}
        <span className="num">{toGo}</span> more RO{toGo === 1 ? "" : "s"} to freeze a dated
        record of everything you&apos;ve documented so far.
      </p>
      {snapshots.length > 0 && (
        <div className="rows-link">
          <Link href="/snapshots" className="zone-link">
            View all (<span className="num">{snapshots.length}</span>)
            <DashIcon name="chev" />
          </Link>
        </div>
      )}
      {latest && (
        <div className="rec-sheet">
          <SnapshotSheet snapshot={latest} timeZone={timeZone} />
        </div>
      )}
    </div>
  );
}
