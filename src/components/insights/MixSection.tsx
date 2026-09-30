"use client";

// What makes a big day — the mix section.
//
// This sits in the "All time" block and deliberately IGNORES the window chips,
// for the same reason Trend does: quartiles cut from one week are three days
// apiece, and four bands built from three days each is noise wearing a chart's
// clothes.
//
// COLOR NOTE, so nobody "fixes" it later. The bars are figure/ground, not a
// categorical pair: heavy-line hours wear the bar ink, everything else wears
// the dim bar. That follows the rule stated in globals.css — "color is
// reserved for state, not decoration" — and it is also what the chart means, since
// the whole finding is that ONE of these two things moves the day. Running a
// categorical palette validator over the pair reports the dim one as
// low-chroma and low-contrast, which is the intended reading, not a defect.
// The sub-3:1 contrast on the dim fill is discharged the way the guidance
// requires: every segment carries a visible number, and the band table below
// repeats all of it as text.
import { Zone } from "@/components/ui/Zone";
import { withPt } from "@/components/ui/Figure";
import { fmtHours } from "@/lib/format";
import {
  driverStrength,
  HEAVY_FLAG_HOURS,
  leadDriver,
  rankedDrivers,
  MIN_DAYS_FOR_BANDS,
  MIN_DAYS_FOR_CORRELATION,
  type DayShape,
  type MixBand,
  type MixDrivers,
  type MixSummary,
} from "@/lib/mix";

const STRENGTH_COPY: Record<string, string> = {
  strong: "Moves your day a lot",
  moderate: "Moves your day somewhat",
  weak: "Barely moves your day",
  none: "Doesn't move your day",
};

/**
 * One decimal for a COUNT of lines — deliberately not fmtHours.
 *
 * Hours in this file go through fmtHours, which rounds half-up and prints
 * "<0.1" rather than a flat "0.0" for a genuinely nonzero value. A line count
 * wants neither: "<0.1 big jobs a day" reads as a measurement of one job
 * instead of an average over days. Keep the two formatters apart.
 */
function oneCount(n: number): string {
  const r = n.toFixed(1);
  return r === "-0.0" ? "0.0" : r;
}

function BandBar({ band, max }: { band: MixBand; max: number }) {
  const heavy = band.avgHeavyFlagHours;
  const rest = Math.max(0, band.avgFlagHours - heavy);
  const pct = (h: number) => (max > 0 ? (h / max) * 100 : 0);

  return (
    <div className="ins-band">
      <span className="ins-band-k">
        {band.days} day{band.days === 1 ? "" : "s"}
      </span>
      {/* The bar. 2px gap between the two fills so the segments read as one
          quantity split rather than two bars touching. */}
      <div className="ins-band-bar">
        <i
          title={`${fmtHours(heavy)}h from jobs ${HEAVY_FLAG_HOURS}h and up`}
          style={{ width: `${pct(heavy)}%`, minWidth: heavy > 0 ? 3 : 0 }}
        />
        <i
          className="is-dim"
          title={`${fmtHours(rest)}h from everything else`}
          style={{ width: `${pct(rest)}%`, minWidth: rest > 0 ? 3 : 0 }}
        />
      </div>
      <span className="num">
        {withPt(fmtHours(band.avgFlagHours))}
        <span className="unit">h</span>
      </span>
    </div>
  );
}

function DriverRow({
  label,
  r,
  lead,
}: {
  label: string;
  r: number | null;
  lead: boolean;
}) {
  const strength = driverStrength(r);
  return (
    <li className={lead ? "is-lead" : undefined}>
      <span className="ins-driver-name">
        {label}
        <span className="ins-driver-how">
          {strength ? STRENGTH_COPY[strength] : "Not enough variation to tell"}
        </span>
      </span>
      {/* |r| as a meter. Only the leading driver is filled with ink; the rest
          stay dim, so the eye lands on the one finding that matters. */}
      <span className="ins-meter" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.abs(r ?? 0) * 100)}%` }} />
      </span>
      <span className="num">{r === null ? "—" : withPt(r.toFixed(2))}</span>
    </li>
  );
}

export function MixSection({
  days,
  bands,
  drivers,
  summary,
}: {
  days: DayShape[];
  bands: MixBand[] | null;
  drivers: MixDrivers;
  summary: MixSummary | null;
}) {
  // Not enough history is reported, never hidden. A tech who cannot yet see this
  // section should be told what unlocks it and how far off they are — a silently
  // absent section reads as a feature that does not exist.
  if (!bands || !summary) {
    return (
      <Zone name="What makes a big day">
        <p className="ins-sub">
          Needs {MIN_DAYS_FOR_BANDS} days of history to split your days into
          quarters — you have {days.length}. Nothing to do but keep logging;
          this fills itself in.
        </p>
      </Zone>
    );
  }

  const max = Math.max(...bands.map((b) => b.avgFlagHours));
  const list = drivers.drivers ?? [];
  const ranked = rankedDrivers(list);
  const leadKey = leadDriver(list)?.key ?? null;

  return (
    <>
      <Zone name="What makes a big day">
        {/* The finding, in one sentence, before any chart. */}
        <p className="ins-sub">
          Your biggest quarter of days pays <b>{fmtHours(summary.bestFlagHours)}h</b>.
          Your quietest pays <b>{fmtHours(summary.worstFlagHours)}h</b>.{" "}
          {summary.quickJobsDontMove ? (
            <>
              The difference isn&rsquo;t how many jobs you turn — it&rsquo;s how
              many <b>big</b> ones. Big jobs go from{" "}
              {oneCount(summary.worstHeavyLines)} a day to{" "}
              {oneCount(summary.bestHeavyLines)}, while quick jobs barely move (
              {oneCount(summary.worstQuickLines)} →{" "}
              {oneCount(summary.bestQuickLines)}).
            </>
          ) : (
            <>
              Big jobs go from {oneCount(summary.worstHeavyLines)} a day to{" "}
              {oneCount(summary.bestHeavyLines)}, quick jobs from{" "}
              {oneCount(summary.worstQuickLines)} to{" "}
              {oneCount(summary.bestQuickLines)}.
            </>
          )}
        </p>

        {/* Legend. Two fills, so it is always present. */}
        <div className="ins-legend">
          <span>
            <i aria-hidden="true" />
            Jobs {HEAVY_FLAG_HOURS}h and up
          </span>
          <span>
            <i className="is-dim" aria-hidden="true" />
            Everything else
          </span>
        </div>

        <div className="ins-bands">
          {/* Biggest first — the shape the tech is aiming at leads. */}
          {[...bands].reverse().map((band) => (
            <BandBar key={band.quartile} band={band} max={max} />
          ))}
        </div>

        <p className="ins-fine">
          Your {days.length} days sorted by flag hours and cut into quarters,
          biggest at the top.
        </p>
      </Zone>

      <Zone name="What a big day actually tracks with">
        {drivers.drivers === null ? (
          <p className="ins-sub">
            Needs {MIN_DAYS_FOR_CORRELATION} days before these are worth
            printing — you have {drivers.days}.
          </p>
        ) : (
          <>
            <ul className="ins-drivers">
              {ranked.map((d) => (
                <DriverRow
                  key={d.key}
                  label={d.label}
                  r={d.r}
                  lead={d.key === leadKey}
                />
              ))}
            </ul>
            <p className="ins-fine">
              &minus;1 to 1. Further from zero means that count tracks your flag
              hours more closely. This is your own history, not a rule of thumb
              — if quick jobs move your day, it will say so.
            </p>
          </>
        )}
      </Zone>
    </>
  );
}
