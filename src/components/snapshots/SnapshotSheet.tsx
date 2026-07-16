// Portfolio snapshot rendered as a vehicle build sheet (design 8B,
// docs/gamification.md). Stats were frozen at generation time and are
// immutable — this component only formats, never recomputes.
import { Check } from "lucide-react";
import type { PortfolioSnapshot } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { MIN_PLAUSIBLE_AVG_VS_BOOK } from "@/lib/snapshots";

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

// created_at is a UTC timestamp — format it in the user's timezone (the
// frt_timezone cookie), not the server's, or a late-evening unlock shows
// tomorrow's date.
function fmtGenerated(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
}

export function SnapshotSheet({
  snapshot,
  timeZone,
}: {
  snapshot: PortfolioSnapshot;
  timeZone?: string;
}) {
  const s = snapshot.stats;
  return (
    <article className="gami-sheet" aria-label={`Portfolio snapshot ${snapshot.seq}`}>
      <div className="gami-sheet-head">
        <div>
          <div className="gami-sheet-eyebrow">Flat Rate Tracker · Work Record</div>
          <div className="gami-sheet-title">SNAPSHOT #{snapshot.seq}</div>
        </div>
        <div className="gami-stamp">
          <Check size={11} aria-hidden="true" /> On record
        </div>
      </div>
      <div className="gami-sheet-grid">
        <div className="gami-sheet-cell">
          <div className="k">ROs documented</div>
          <div className="v">{s.roCount}</div>
        </div>
        <div className="gami-sheet-cell">
          <div className="k">Hours flagged</div>
          <div className="v">{fmt(s.totalFlagHours)}</div>
        </div>
        <div className="gami-sheet-cell">
          <div className="k">Avg vs book</div>
          <div className="v">
            {/* Trust floor: snapshots frozen before the builder's junk-data
                guard can carry implausible ratios (0.01×) — show "—" instead. */}
            {s.avgVsBook !== null && s.avgVsBook >= MIN_PLAUSIBLE_AVG_VS_BOOK ? (
              <>
                {s.avgVsBook.toFixed(2)}
                <small>×</small>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
        <div className="gami-sheet-cell">
          <div className="k">Photos on file</div>
          <div className="v">{s.photoCount}</div>
        </div>
      </div>
      <div className="gami-sheet-specs">
        {s.topOps.length > 0 && (
          <>
            <b>Top operations:</b>{" "}
            {s.topOps.map((op) => `${op.code} (${op.count})`).join(" · ")}
            <br />
          </>
        )}
        {s.overallEfficiency != null && (
          <>
            <b>Overall efficiency:</b> {Math.round(s.overallEfficiency)}%
            {s.efficiencySource === "scheduled"
              ? " (vs scheduled hours)"
              : s.efficiencySource === "mixed"
                ? " (vs clocked + scheduled hours)"
                : " (vs clocked hours)"}
            <br />
          </>
        )}
        <b>Range:</b> {formatDateShort(s.firstDate)} → {formatDateShort(s.lastDate)} ·{" "}
        {s.workDays} work {s.workDays === 1 ? "day" : "days"}
      </div>
      <div className="gami-sheet-foot">
        <span>Generated {fmtGenerated(snapshot.createdAt, timeZone)}</span>
        <span>RO #{snapshot.roThreshold} line</span>
      </div>
    </article>
  );
}
