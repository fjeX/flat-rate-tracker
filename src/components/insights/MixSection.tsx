"use client";

// What makes a big day — the mix section.
//
// This sits in the "All time" block and deliberately IGNORES the window chips,
// for the same reason Trend does: quartiles cut from one week are three days
// apiece, and four bands built from three days each is noise wearing a chart's
// clothes.
//
// COLOR NOTE, so nobody "fixes" it later. The bars are figure/ground, not a
// categorical pair: heavy-line hours wear --brand, everything else wears a
// neutral surface. That follows the rule stated in globals.css — "color is
// reserved for state, not decoration" — and it is also what the chart means, since
// the whole finding is that ONE of these two things moves the day. Running a
// categorical palette validator over the pair reports the neutral as
// low-chroma and low-contrast, which is the intended reading, not a defect; the
// checks that matter pass wide (CVD separation ΔE 34-44 against a target of 8).
// The sub-3:1 contrast on the neutral is discharged the way the guidance
// requires: every segment carries a visible number, and the band table below
// repeats all of it as text.
import { Card } from "@/components/ui/Card";
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
    <div className="flex items-center gap-3">
      <div
        className="shrink-0 text-[11px] tabular-nums"
        style={{ width: 58, color: "var(--fg-3)" }}
      >
        {band.days} day{band.days === 1 ? "" : "s"}
      </div>

      {/* The bar. 2px gap between the two fills, rounded outer end only, so the
          segments read as one quantity split rather than two bars touching. */}
      <div className="flex h-5 flex-1 items-stretch" style={{ gap: 2 }}>
        <div
          title={`${fmtHours(heavy)}h from jobs ${HEAVY_FLAG_HOURS}h and up`}
          style={{
            width: `${pct(heavy)}%`,
            background: "var(--brand)",
            borderRadius: rest > 0 ? "4px 0 0 4px" : 4,
            minWidth: heavy > 0 ? 3 : 0,
          }}
        />
        <div
          title={`${fmtHours(rest)}h from everything else`}
          style={{
            width: `${pct(rest)}%`,
            background: "var(--bg-4)",
            borderRadius: heavy > 0 ? "0 4px 4px 0" : 4,
            minWidth: rest > 0 ? 3 : 0,
          }}
        />
      </div>

      <div
        className="mono shrink-0 text-right text-sm font-semibold tabular-nums"
        style={{ width: 52, color: "var(--fg-1)" }}
      >
        {fmtHours(band.avgFlagHours)}h
      </div>
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
    <div className="flex items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm"
          style={{ color: lead ? "var(--fg-0)" : "var(--fg-2)" }}
        >
          {label}
        </div>
        <div className="text-[11px]" style={{ color: "var(--fg-3)" }}>
          {strength ? STRENGTH_COPY[strength] : "Not enough variation to tell"}
        </div>
      </div>
      {/* |r| as a meter. Only the leading driver is filled with brand; the rest
          stay neutral, so the eye lands on the one finding that matters. */}
      <div
        className="h-1.5 shrink-0 overflow-hidden rounded-full"
        style={{ width: 76, background: "var(--bg-3)" }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.abs(r ?? 0) * 100)}%`,
            height: "100%",
            background: lead ? "var(--brand)" : "var(--bg-4)",
            borderRadius: 999,
          }}
        />
      </div>
      <div
        className="mono shrink-0 text-right text-xs tabular-nums"
        style={{ width: 40, color: "var(--fg-2)" }}
      >
        {r === null ? "—" : r.toFixed(2)}
      </div>
    </div>
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
      <section>
        <div className="section-title">What makes a big day</div>
        <Card>
          <p className="text-sm" style={{ color: "var(--fg-2)" }}>
            Needs {MIN_DAYS_FOR_BANDS} days of history to split your days into
            quarters — you have {days.length}. Nothing to do but keep logging;
            this fills itself in.
          </p>
        </Card>
      </section>
    );
  }

  const max = Math.max(...bands.map((b) => b.avgFlagHours));
  const list = drivers.drivers ?? [];
  const ranked = rankedDrivers(list);
  const leadKey = leadDriver(list)?.key ?? null;

  return (
    <section>
      <div className="section-title">What makes a big day</div>

      <Card className="space-y-4">
        {/* The finding, in one sentence, before any chart. */}
        <p className="text-sm" style={{ color: "var(--fg-1)" }}>
          Your biggest quarter of days pays{" "}
          <strong className="mono tabular-nums" style={{ color: "var(--fg-0)" }}>
            {fmtHours(summary.bestFlagHours)}h
          </strong>
          . Your quietest pays{" "}
          <strong className="mono tabular-nums" style={{ color: "var(--fg-0)" }}>
            {fmtHours(summary.worstFlagHours)}h
          </strong>
          .{" "}
          {summary.quickJobsDontMove ? (
            <>
              The difference isn&rsquo;t how many jobs you turn — it&rsquo;s how
              many <strong style={{ color: "var(--fg-0)" }}>big</strong> ones. Big
              jobs go from {oneCount(summary.worstHeavyLines)} a day to{" "}
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
        <div className="flex flex-wrap items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1.5" style={{ color: "var(--fg-2)" }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "var(--brand)",
              }}
            />
            Jobs {HEAVY_FLAG_HOURS}h and up
          </span>
          <span className="flex items-center gap-1.5" style={{ color: "var(--fg-2)" }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: "var(--bg-4)",
              }}
            />
            Everything else
          </span>
        </div>

        <div className="space-y-2">
          {/* Biggest first — the shape the tech is aiming at leads. */}
          {[...bands].reverse().map((band) => (
            <BandBar key={band.quartile} band={band} max={max} />
          ))}
        </div>

        <p className="text-xs" style={{ color: "var(--fg-3)" }}>
          Your {days.length} days sorted by flag hours and cut into quarters,
          biggest at the top.
        </p>
      </Card>

      <div className="mt-4">
        <Card className="space-y-1">
          <div className="field-label">What a big day actually tracks with</div>
          {drivers.drivers === null ? (
            <p className="pt-1 text-sm" style={{ color: "var(--fg-2)" }}>
              Needs {MIN_DAYS_FOR_CORRELATION} days before these are worth
              printing — you have {drivers.days}.
            </p>
          ) : (
            <>
              <div className="pt-1">
                {ranked.map((d) => (
                  <DriverRow
                    key={d.key}
                    label={d.label}
                    r={d.r}
                    lead={d.key === leadKey}
                  />
                ))}
              </div>
              <p className="pt-1 text-xs" style={{ color: "var(--fg-3)" }}>
                &minus;1 to 1. Further from zero means that count tracks your flag
                hours more closely. This is your own history, not a rule of thumb
                — if quick jobs move your day, it will say so.
              </p>
            </>
          )}
        </Card>
      </div>
    </section>
  );
}
