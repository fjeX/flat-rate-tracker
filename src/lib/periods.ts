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
// ------------------------------------------------------------------------

// Return the period that contains the given date, honoring overrides.
export function getPeriodForDate(
  date: string,
  splitDay: number,
  overrides: Record<string, PeriodOverride> = {},
): PeriodRange {
  for (const [key, range] of Object.entries(overrides)) {
    if (date >= range.start && date <= range.end) {
      return { key, start: range.start, end: range.end };
    }
  }

  const [yearStr, monthStr, dayStr] = date.split("-");
  const year = Number(yearStr);
  const month1 = Number(monthStr);
  const day = Number(dayStr);

  if (day <= splitDay) {
    return {
      key: `${yearStr}-${monthStr}-P1`,
      start: `${yearStr}-${monthStr}-01`,
      end: `${yearStr}-${monthStr}-${pad2(splitDay)}`,
    };
  }

  return {
    key: `${yearStr}-${monthStr}-P2`,
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
  if (overrides[key]) {
    return { key, start: overrides[key].start, end: overrides[key].end };
  }
  const match = key.match(/^(\d{4})-(\d{2})-P([12])$/);
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
