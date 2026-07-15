// Dashboard entry point for portfolio snapshots: progress to the next
// unlock, plus the latest build sheet (docs/gamification.md, design 8B).
import Link from "next/link";
import type { PortfolioSnapshot } from "@/lib/types";
import { EntranceGrid } from "@/components/ui/EntranceGrid";
import { SnapshotSheet } from "@/components/snapshots/SnapshotSheet";

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
    <section>
      <div className="section-title">
        Portfolio snapshots
        {snapshots.length > 0 && (
          <Link href="/snapshots" className="link">
            View all ({snapshots.length}) →
          </Link>
        )}
      </div>
      <EntranceGrid className="card padded gami-snap" animationName="pace-grow">
        <div className="gami-snap-head">
          <span className="gami-snap-title">
            {latest ? `Next: Snapshot #${latest.seq + 1}` : "Your first snapshot"}
          </span>
          <span className="gami-snap-count">
            <b>{roCount}</b> / {nextSnapshotAt} ROs
          </span>
        </div>
        <div className="gami-snap-bar">
          <i style={{ width: `${frac * 100}%` }} />
        </div>
        <p className="gami-snap-sub">
          Log {toGo} more RO{toGo === 1 ? "" : "s"}{" "}
          to freeze a dated record of everything you&apos;ve documented so far.
        </p>
        {latest && (
          <div className="gami-snap-sheetwrap">
            <SnapshotSheet snapshot={latest} timeZone={timeZone} />
          </div>
        )}
      </EntranceGrid>
    </section>
  );
}
