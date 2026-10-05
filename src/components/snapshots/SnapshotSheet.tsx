// Portfolio snapshot rendered as a work record (design 8B,
// docs/gamification.md). Stats were frozen at generation time and are
// immutable — this component only formats, never recomputes.
//
// Phase 5: the sheet is the app's one "hard copy" object (a filled panel with
// the heavy top rule, a spec row of four figures, the specs as a ruled note,
// a label-style footer). The class names `.gami-sheet-cell .k / .v` and
// `.gami-sheet-specs` are kept: the colocated test reads them.
import type { PortfolioSnapshot } from "@/lib/types";
import { formatDateShort } from "@/lib/periods";
import { MIN_PLAUSIBLE_AVG_VS_BOOK } from "@/lib/snapshots";
import { fmtHoursGrouped } from "@/lib/format";
import { efficiencyDisplay } from "@/lib/efficiency-display";
import { Badge } from "@/components/ui/Badge";
import { withPt } from "@/components/ui/Figure";

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
          <div className="gami-sheet-title">
            Snapshot <span className="num">#{snapshot.seq}</span>
          </div>
        </div>
        <Badge tone="good">On record</Badge>
      </div>
      <dl className="spec">
        <div className="gami-sheet-cell">
          <dt className="k">ROs documented</dt>
          <dd className="v">{s.roCount}</dd>
        </div>
        <div className="gami-sheet-cell">
          <dt className="k">Hours flagged</dt>
          {/* Grouped: a snapshot cut at a later RO threshold sits thousands of
              hours in. Trailing zero kept — this sheet is handed to a service
              manager, so it should read like every other surface, and the old
              private formatter dropped it ("2" for 2.0h). */}
          <dd className="v">{withPt(fmtHoursGrouped(s.totalFlagHours))}</dd>
        </div>
        <div className="gami-sheet-cell">
          <dt className="k">Avg vs book</dt>
          <dd className="v">
            {/* Trust floor: snapshots frozen before the builder's junk-data
                guard can carry implausible ratios (0.01×) — show "—" instead. */}
            {s.avgVsBook !== null && s.avgVsBook >= MIN_PLAUSIBLE_AVG_VS_BOOK ? (
              <>
                {withPt(s.avgVsBook.toFixed(2))}
                <small>×</small>
                {/* Mono n=, only where the snapshot recorded it (older frozen
                    sheets did not — say nothing rather than guess). */}
                {s.avgVsBookLines !== undefined && (
                  <small className="ins-stat" style={{ fontFamily: "var(--font-num)" }}> n={s.avgVsBookLines}</small>
                )}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {/* Took Photos on file's place (Liem, 2026-10-04): few techs photograph
            their ROs, and efficiency is the figure a service manager actually
            asks about. photoCount is still frozen in the stats blob, just not
            printed. Withheld or absent reads "—", and a withheld figure is
            explained in the specs below. */}
        <div className="gami-sheet-cell">
          <dt className="k">Overall efficiency</dt>
          <dd className="v">
            {eff.kind === "shown" ? (
              <>
                {withPt(String(Math.round(eff.pct)))}
                <small>%</small>
                <small className="sub">
                  {s.efficiencySource === "scheduled"
                    ? "vs scheduled hours"
                    : s.efficiencySource === "mixed"
                      ? "vs clocked + scheduled"
                      : "vs clocked hours"}
                </small>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      <div className="gami-sheet-specs">
        {s.topOps.length > 0 && (
          <>
            <b>Top operations:</b>{" "}
            {s.topOps.map((op) => `${op.code} (${op.count})`).join(" · ")}
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
        <span>RO <span className="num">#{snapshot.roThreshold}</span> line</span>
      </div>
    </article>
  );
}
