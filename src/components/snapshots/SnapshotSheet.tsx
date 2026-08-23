// Portfolio snapshot rendered as a vehicle build sheet (design 8B,
// docs/gamification.md). Stats were frozen at generation time and are
// immutable — this component only formats, never recomputes.
import { Check } from "lucide-react";
import type { PortfolioSnapshot } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { MIN_PLAUSIBLE_AVG_VS_BOOK } from "@/lib/snapshots";
import { fmtHoursGrouped } from "@/lib/format";
import { efficiencyDisplay } from "@/lib/efficiency-display";

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
  /**
   * Same classifier as every live efficiency surface — this sheet was the one
   * that never used it, and the only one whose number is PERMANENT: it is
   * written to the DB, carried verbatim through the backup bundle, and handed
   * to a service manager as "proof of what you'd documented at that point".
   * A hollowed percentage is most dangerous exactly here, because it looks
   * plausible and nobody can re-derive it from the sheet.
   *
   * `?? undefined` on the unpaired fields, not `?? 0`: null means the snapshot
   * has no schedule behind it (nothing measurable to exclude) and absent means
   * it was frozen before the fields existed. Neither is "0 hours were
   * excluded", which is a real measurement efficiencyDisplay must be free to
   * act on. Both non-values land on `shown`/`none` — the pre-existing
   * behaviour — until the backfill fills them in.
   */
  const eff = efficiencyDisplay({
    flagHours: s.totalFlagHours,
    efficiency: s.overallEfficiency ?? null,
    unpairedFlagHours: s.unpairedFlagHours ?? undefined,
    unpairedDays: s.unpairedDays ?? undefined,
  });
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
          {/* Grouped: a snapshot cut at a later RO threshold sits thousands of
              hours in. Trailing zero kept — this sheet is handed to a service
              manager, so it should read like every other surface, and the old
              private formatter dropped it ("2" for 2.0h). */}
          <div className="v">{fmtHoursGrouped(s.totalFlagHours)}</div>
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
        {eff.kind === "shown" && (
          <>
            <b>Overall efficiency:</b> {Math.round(eff.pct)}%
            {s.efficiencySource === "scheduled"
              ? " (vs scheduled hours)"
              : s.efficiencySource === "mixed"
                ? " (vs clocked + scheduled hours)"
                : " (vs clocked hours)"}
            <br />
          </>
        )}
        {/* Withheld, and said plainly. The live surfaces word this as "no
            efficiency YET … flagged SO FAR" — true of a period still running,
            false of a record frozen months ago and handed to a service
            manager. Nothing here is going to resolve later, so the copy states
            what the range contained and stops. */}
        {eff.kind === "all_excluded" && (
          <>
            <b>Overall efficiency:</b> not measurable —{" "}
            {fmtHoursGrouped(eff.excludedHours)}h, all of the flagged hours in
            this range, fell on {eff.days === 1 ? "a day" : `${eff.days} days`}{" "}
            with no hours to measure {eff.days === 1 ? "it" : "them"} against.
            <br />
          </>
        )}
        {eff.kind === "mostly_excluded" && (
          <>
            <b>Overall efficiency:</b> not shown —{" "}
            {fmtHoursGrouped(eff.excludedHours)}h of the{" "}
            {fmtHoursGrouped(eff.totalHours)}h flagged in this range fell on{" "}
            {eff.days === 1 ? "a day" : `${eff.days} days`} with no hours to
            measure {eff.days === 1 ? "it" : "them"} against, so a percentage
            would leave out most of the work.
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
