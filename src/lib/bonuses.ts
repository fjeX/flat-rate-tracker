// Pure bonus/spiff math. No I/O, no React — a plain function of a bonus list,
// so it's trivially unit-testable and safe from Server Components, client
// components, and tests alike. Mirrors the shape of lib/earnings.ts.
//
// Design notes:
//  - Bonuses are dollar-denominated natively. NONE of this needs a labor rate —
//    a spiff total is real money even for a user who never priced a rate.
//  - Bonuses are NEVER flag hours. They roll into dollar totals only; hours
//    reconciliation ignores them entirely (see docs/plans 05).
import type { Bonus, BonusCategory } from "./types";

export const BONUS_CATEGORIES: readonly BonusCategory[] = [
  "spiff",
  "bonus",
  "holiday",
  "other",
] as const;

export const BONUS_CATEGORY_LABELS: Record<BonusCategory, string> = {
  spiff: "Spiff",
  bonus: "Bonus",
  holiday: "Holiday pay",
  other: "Other",
};

// Bonuses whose date falls in [start, end] inclusive. Boundary dates count —
// a spiff dated exactly on the period start or end belongs to that period.
export function filterBonusesInRange(
  bonuses: Bonus[],
  start: string,
  end: string,
): Bonus[] {
  return bonuses.filter((b) => b.date >= start && b.date <= end);
}

// Total dollars across a set of bonuses. Callers filter to the period first.
export function sumBonuses(bonuses: Bonus[]): number {
  return bonuses.reduce((sum, b) => sum + b.amount, 0);
}

export type PeriodTotalPay = {
  flagPay: number | null; // null when no rates are priced (dollars unknown)
  bonusTotal: number; // always a real number — spiffs need no rates
  total: number; // flagPay (or 0) + bonusTotal
  // Only true when BOTH a priced flag figure AND bonuses exist — that's the only
  // case where the "Flag pay $X + Spiffs $Y = $Z" breakdown is worth showing.
  showBreakdown: boolean;
};

// Combine plan-02 flag-pay dollars with this period's spiff total.
//  - flagPay is `periodEarnings(...)` when rates exist, else null.
//  - bonusTotal is always available (dollars, no rates needed).
export function periodTotalPay(
  flagPay: number | null,
  bonusTotal: number,
): PeriodTotalPay {
  const total = (flagPay ?? 0) + bonusTotal;
  return {
    flagPay,
    bonusTotal,
    total,
    showBreakdown: flagPay !== null && bonusTotal > 0,
  };
}
