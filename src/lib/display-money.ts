// Display-only money rules. Nothing here may be fed into rate math.
//
// One rule lives here today: the printed "total pay" made of flag pay plus
// bonuses. fmtMoney prints whole dollars, so a total computed as an exact sum
// and then rounded can disagree with its own printed addends by a dollar
// (489.775 + 27.50 -> "$490 + $28 = $517"). Rounding each term first and then
// adding makes the printed total a sum of the printed rows by construction.
//
// TWIN: lib/bonuses.ts `periodTotalPay` (the `total` field) applies this exact
// rule for SpiffsCard. Both cards can be on screen at once showing the same
// period, so the two must never drift — `display-money.test.ts` pins them to
// each other. Change one, change both.
import { roundAtScale } from "./format";

/**
 * The whole-dollar total a card PRINTS for "flag pay + bonuses".
 *
 * DISPLAY ONLY. Never divide this into an hourly rate, compare it to a wage
 * floor, forecast from it, or export it — the exact money is `flagPay +
 * bonusTotal`, unrounded, and every rate path must keep using that.
 */
export function displayTotalPay(flagPay: number, bonusTotal: number): number {
  return roundAtScale(flagPay, 1) + roundAtScale(bonusTotal, 1);
}
