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
import { roundAtScale } from "./format";

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
  // DISPLAY figure, and only that: the sum of the two terms AFTER each is
  // rounded to whole dollars, not a rounding of the raw sum. The one consumer
  // (SpiffsCard) prints all three through fmtMoney, which is whole-dollar, so a
  // raw sum makes the sentence contradict itself — 489.70 + 27.50 prints
  // "$490 + $28 = $517". Do NOT reuse this for rate math or exports; the exact
  // money is `flagPay` + `bonusTotal`, which stay unrounded on purpose.
  total: number;
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
  // Round each term first, then add — the same house pattern as
  // lib/unpaid-summary (totalDollars) and lib/dispute-pack (totalShortDollars):
  // a printed total that is a sum of the printed rows can never disagree with
  // them. Rounding the raw sum instead loses by up to a dollar in either
  // direction (489.70+27.50 -> 517 vs 518; 100.40+50.40 -> 151 vs 150).
  //
  // The rounding lives HERE, not in fmtMoney/roundAtScale: those are shared by
  // every money figure in the app and must keep the sub-cent tail that
  // hours x rate legitimately carries (see earnings.ts fmtMoney, escalation
  // shortfall-one-decimal-float). Scale 1 == whole dollars == what fmtMoney
  // prints, so fmtMoney(total) is this number verbatim.
  const total = roundAtScale(flagPay ?? 0, 1) + roundAtScale(bonusTotal, 1);
  return {
    flagPay,
    bonusTotal,
    total,
    // Gated on the RAW bonus total: a real $0.40 spiff still earns its line in
    // the breakdown even though it prints as $0.
    showBreakdown: flagPay !== null && bonusTotal > 0,
  };
}
