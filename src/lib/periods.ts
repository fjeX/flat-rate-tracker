// Semi-monthly pay period helpers.
//
// Period keys are strings like "2026-04-P1" and "2026-04-P2".
// P1 = 1st..splitDay. P2 = (splitDay+1)..end of month. Overrides win.
//
// All date inputs/outputs are "YYYY-MM-DD" strings. We avoid Date objects
// at the boundaries so server/client timezones can't disagree.
import type { PeriodOverride } from "./types";

export type PeriodRange = {
  key: string;
  start: string; // "YYYY-MM-DD" inclusive
  end: string; // "YYYY-MM-DD" inclusive
};

// ------------------------------------------------------------------------
// Date primitives (string-based to avoid timezone foot-guns)
// ------------------------------------------------------------------------

export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Like isoDate() but converts to a specific IANA timezone first.
// Fixes the day-rollover bug where the server (UTC) thinks "today" is different
// from what the user's local clock shows.
export function isoDateInTz(tz: string, d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return isoDate(d);
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month1: number): number {
  // month1 is 1-based. new Date(y, m, 0) = last day of month m-1+1 == m.
  return new Date(year, month1, 0).getDate();
}

// Add days to a YYYY-MM-DD string, returning YYYY-MM-DD.
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return isoDate(dt);
}

export function startOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-${pad2(m)}-01`;
}

export function endOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
}

// weekStartDay: 0 = Sunday (default), 1 = Monday
export function startOfWeek(date: string, weekStartDay: 0 | 1 = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0=Sun
  const offset = weekStartDay === 0 ? dow : (dow === 0 ? 6 : dow - 1);
  dt.setDate(dt.getDate() - offset);
  return isoDate(dt);
}

export function endOfWeek(date: string, weekStartDay: 0 | 1 = 0): string {
  return addDays(startOfWeek(date, weekStartDay), 6);
}

// ------------------------------------------------------------------------
// Period resolution
//
// Periods are a CHAIN, not a set of independent ranges. A shop's real pay
// boundary drifts (paid through the 30th one period, the 14th the next), and a
// tech records that drift by overriding one period key at a time. Overriding a
// period's end therefore also moves the NEXT period's start — otherwise the days
// in between belong to nothing, and the two resolvers below disagree about where
// they went. That disagreement was a real bug: with 2026-07-P2 overridden to end
// Jul 30, the pay-period tab read "Jul 15 – Jul 30" while an RO logged on Jul 31
// was still filed into 2026-07-P2, because only one of the two functions was
// looking at the override.
//
// So both functions resolve through the same rule:
//   start = previous period's override end + 1, else the default start
//   end   = next period's override start − 1,   else the default end
//
// The payoff is that the next period does not have to exist yet. The day after
// an overridden period ends rolls into the following period on its own.
// ------------------------------------------------------------------------

const PERIOD_KEY_RE = /^(\d{4})-(\d{2})-P([12])$/;

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

// The keys either side of a standard period key, or null for a custom key
// (overrides may be keyed by anything — those have no chain to walk).
export function getNeighborPeriodKeys(
  key: string,
): { prev: string; next: string } | null {
  const match = key.match(PERIOD_KEY_RE);
  if (!match) return null;
  const [, yearStr, monthStr, phaseStr] = match;
  const year = Number(yearStr);
  const month1 = Number(monthStr);
  if (phaseStr === "1") {
    const py = month1 === 1 ? year - 1 : year;
    const pm = month1 === 1 ? 12 : month1 - 1;
    return {
      prev: `${pad4(py)}-${pad2(pm)}-P2`,
      next: `${yearStr}-${monthStr}-P2`,
    };
  }
  const ny = month1 === 12 ? year + 1 : year;
  const nm = month1 === 12 ? 1 : month1 + 1;
  return {
    prev: `${yearStr}-${monthStr}-P1`,
    next: `${pad4(ny)}-${pad2(nm)}-P1`,
  };
}

// The un-overridden range a standard key would have on its own.
function defaultRangeForKey(key: string, splitDay: number): PeriodRange | null {
  const match = key.match(PERIOD_KEY_RE);
  if (!match) return null;
  const [, yearStr, monthStr, phaseStr] = match;
  const year = Number(yearStr);
  const month1 = Number(monthStr);
  if (phaseStr === "1") {
    return {
      key,
      start: `${yearStr}-${monthStr}-01`,
      end: `${yearStr}-${monthStr}-${pad2(splitDay)}`,
    };
  }
  return {
    key,
    start: `${yearStr}-${monthStr}-${pad2(splitDay + 1)}`,
    end: `${yearStr}-${monthStr}-${pad2(daysInMonth(year, month1))}`,
  };
}

// Resolve an arbitrary period key ("2026-04-P1") back to a range.
export function getRangeForPeriodKey(
  key: string,
  splitDay: number,
  overrides: Record<string, PeriodOverride> = {},
): PeriodRange | null {
  // The key's own override is the whole answer — it is what the tech typed.
  if (overrides[key]) {
    return { key, start: overrides[key].start, end: overrides[key].end };
  }
  const def = defaultRangeForKey(key, splitDay);
  if (!def) return null;

  const neighbors = getNeighborPeriodKeys(key);
  if (!neighbors) return def;
  const prevOverride = overrides[neighbors.prev];
  const nextOverride = overrides[neighbors.next];
  if (!prevOverride && !nextOverride) return def;

  const start = prevOverride ? addDays(prevOverride.end, 1) : def.start;
  let end = nextOverride ? addDays(nextOverride.start, -1) : def.end;
  // Overlapping overrides (the previous one ends after the next one starts)
  // would leave this period inverted, which silently matches no dates at all.
  // Collapse it to a single day instead so it still exists and its numbers
  // still render. Only reachable from contradictory overrides — the default
  // path above is left exactly as it was.
  if (start > end) end = start;
  return { key, start, end };
}

// Return the period that contains the given date, honoring overrides.
export function getPeriodForDate(
  date: string,
  splitDay: number,
  overrides: Record<string, PeriodOverride> = {},
): PeriodRange {
  // An override that literally contains the date wins outright — including
  // custom keys that don't follow the YYYY-MM-P{1,2} shape.
  for (const [key, range] of Object.entries(overrides)) {
    if (date >= range.start && date <= range.end) {
      return { key, start: range.start, end: range.end };
    }
  }

  const [yearStr, monthStr, dayStr] = date.split("-");
  const day = Number(dayStr);
  const candidateKey = `${yearStr}-${monthStr}-P${day <= splitDay ? "1" : "2"}`;

  // Resolve the candidate through the chain rather than the raw split-day math.
  // Constructed from the date, so the key always parses and this is never null.
  const candidate = getRangeForPeriodKey(candidateKey, splitDay, overrides)!;
  if (date >= candidate.start && date <= candidate.end) return candidate;

  // The date fell outside — an override moved this period's boundary away from
  // it. It belongs to whichever neighbor it drifted toward: that neighbor has
  // no override of its own (or the containment loop above would have caught the
  // date), so the chain rule has already widened it to meet the boundary and
  // the date lands inside.
  //
  // The one case where it does not: two adjacent overrides that leave an
  // explicit hole between them (P1 ends the 10th, P2 starts the 20th). Those
  // days belong to no period the tech defined. They are filed into the period
  // they border rather than dropped, and setPeriodOverrideAction refuses to
  // create the hole in the first place.
  const neighbors = getNeighborPeriodKeys(candidateKey)!;
  const neighborKey = date > candidate.end ? neighbors.next : neighbors.prev;
  const neighbor = getRangeForPeriodKey(neighborKey, splitDay, overrides);
  if (neighbor) return neighbor;

  // Unreachable for a standard key (neighborKeys and getRangeForPeriodKey agree
  // on which keys parse), but a total function beats a crash on the page that
  // shows a tech their pay.
  return candidate;
}

// ------------------------------------------------------------------------
// Formatting
// ------------------------------------------------------------------------

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "Apr 16 – Apr 30" — stable in every timezone because we just parse the
// YYYY-MM-DD components directly.
export function formatPeriodLabel(range: PeriodRange): string {
  const fmt = (d: string) => {
    const [, m, day] = d.split("-").map(Number);
    return `${MONTHS_SHORT[m - 1]} ${day}`;
  };
  return `${fmt(range.start)} – ${fmt(range.end)}`;
}

// "Apr 21, 2026"
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
}

// "Apr 21"
export function formatDateShort(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}
