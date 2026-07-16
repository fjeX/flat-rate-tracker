// Pure earnings math. No I/O, no React — everything here is a plain function of
// (entries/lines) × (rate map) so it's trivially unit-testable and safe to call
// from Server Components, client components, and the guest store alike.
//
// Design notes:
//  - A "rate map" is just the user's labor_rates flattened to { type: $/hr }.
//    A type absent from the map is UNPRICED.
//  - An untyped line (labor_type null — every historical line) falls back to the
//    customer_pay rate. That's the pragmatic default: before this feature existed
//    every line was implicitly customer-pay work.
//  - When a line's applicable rate is unpriced, its earnings are `null`, NOT 0 —
//    callers decide whether to show "—" or roll it into a sum as 0. This is what
//    lets the whole feature degrade to hours-only when no rates are set.
import type { Entry, EntryOpCode, LaborRate, LaborType } from "./types";

export const LABOR_TYPES: readonly LaborType[] = [
  "customer_pay",
  "warranty",
  "internal",
  "used_car",
  "other",
] as const;

export const LABOR_TYPE_LABELS: Record<LaborType, string> = {
  customer_pay: "Customer Pay",
  warranty: "Warranty",
  internal: "Internal",
  used_car: "Used Car",
  other: "Other",
};

// Short labels for the compact per-line selector.
export const LABOR_TYPE_SHORT: Record<LaborType, string> = {
  customer_pay: "CP",
  warranty: "War",
  internal: "Int",
  used_car: "UC",
  other: "Oth",
};

export type RateMap = Partial<Record<LaborType, number>>;

// Flatten labor_rates rows into a lookup. Non-positive rates are treated as
// "unset" so a stray 0 row never masquerades as a real, priced rate.
export function ratesToMap(rates: LaborRate[]): RateMap {
  const map: RateMap = {};
  for (const r of rates) {
    if (Number.isFinite(r.hourlyRate) && r.hourlyRate > 0) {
      map[r.laborType] = r.hourlyRate;
    }
  }
  return map;
}

// Is at least one rate priced? Gates every dollar figure in the UI.
export function hasAnyRate(rates: RateMap): boolean {
  return LABOR_TYPES.some((t) => rates[t] !== undefined);
}

// The rate that applies to a single line, or null if that type is unpriced.
// Implicitly untyped (null, historical) lines resolve against customer_pay;
// explicitly "untyped" lines are always unpriced.
export function resolveLineRate(
  line: Pick<EntryOpCode, "laborType">,
  rates: RateMap,
): number | null {
  if (line.laborType === "untyped") return null;
  const type: LaborType = line.laborType ?? "customer_pay";
  return rates[type] ?? null;
}

// Dollars for one line, or null when the applicable rate is unpriced.
export function lineEarnings(
  line: Pick<EntryOpCode, "laborType" | "flagHours">,
  rates: RateMap,
): number | null {
  const rate = resolveLineRate(line, rates);
  if (rate === null) return null;
  return rate * line.flagHours;
}

// Dollars for a whole RO. Unpriced lines contribute 0 (not null) so a mixed RO
// still totals the part we can price.
export function entryEarnings(entry: Entry, rates: RateMap): number {
  return entry.opCodes.reduce(
    (sum, line) => sum + (lineEarnings(line, rates) ?? 0),
    0,
  );
}

// Dollars across a set of entries. Callers filter to the period they care about.
export function periodEarnings(entries: Entry[], rates: RateMap): number {
  return entries.reduce((sum, e) => sum + entryEarnings(e, rates), 0);
}

export type LaborTypeBreakdown = {
  laborType: LaborType;
  flagHours: number;
  earnings: number; // 0 when the type is unpriced
  priced: boolean;
};

// Flag hours and dollars grouped by labor type. Implicitly untyped (null)
// lines roll into customer_pay (mirroring the earnings fallback); explicitly
// "untyped" lines are excluded. Only types with hours appear.
export function earningsByLaborType(
  entries: Entry[],
  rates: RateMap,
): LaborTypeBreakdown[] {
  const hours: Record<LaborType, number> = {
    customer_pay: 0,
    warranty: 0,
    internal: 0,
    used_car: 0,
    other: 0,
  };
  for (const e of entries) {
    for (const line of e.opCodes) {
      if (line.laborType === "untyped") continue;
      const type: LaborType = line.laborType ?? "customer_pay";
      hours[type] += line.flagHours;
    }
  }
  return LABOR_TYPES.map((t) => {
    const priced = rates[t] !== undefined;
    return {
      laborType: t,
      flagHours: hours[t],
      earnings: (rates[t] ?? 0) * hours[t],
      priced,
    };
  }).filter((b) => b.flagHours > 0);
}

// The leapfrog stat: money left on the table because warranty pays less than
// customer pay. Only meaningful when BOTH rates are set — returns null otherwise
// so the UI can hide it entirely. Only lines explicitly typed "warranty" count
// (untyped lines are treated as customer_pay, so they can't be a warranty loss).
export function warrantyLoss(entries: Entry[], rates: RateMap): number | null {
  const cp = rates.customer_pay;
  const wr = rates.warranty;
  if (cp === undefined || wr === undefined) return null;
  const diff = cp - wr;
  if (diff <= 0) return 0;
  const warrantyHours = entries.reduce(
    (sum, e) =>
      sum +
      e.opCodes.reduce(
        (s, l) => s + (l.laborType === "warranty" ? l.flagHours : 0),
        0,
      ),
    0,
  );
  return diff * warrantyHours;
}

// Whole-dollar currency formatting. Cents are noise on a period total ("$412")
// and rarely meaningful on a single flat-rate line either.
export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
