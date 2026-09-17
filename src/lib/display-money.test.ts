import { describe, it, expect } from "vitest";
import { displayTotalPay } from "./display-money";
import { periodTotalPay } from "./bonuses";
import { fmtMoney } from "./earnings";

// The rule is duplicated by necessity (bonuses.ts owns SpiffsCard's copy and is
// not importable-from without a cycle risk), so it is pinned here instead: any
// edit to either side that changes a result fails this test.
describe("displayTotalPay — twinned with periodTotalPay", () => {
  const cases: [number, number][] = [
    [489.775, 27.5],
    [489.7, 27.5],
    [100.4, 50.4],
    [0, 0],
    [0, 0.4],
    [1234.56, 0],
    [-12.5, 3.25],
  ];
  it.each(cases)("agrees with periodTotalPay (%f + %f)", (flag, bonus) => {
    expect(displayTotalPay(flag, bonus)).toBe(periodTotalPay(flag, bonus).total);
  });

  it("makes the printed addends add up to the printed total", () => {
    // 489.775 -> $490, 27.50 -> $28, and the total must print $518, not $517.
    expect(fmtMoney(displayTotalPay(489.775, 27.5))).toBe("$518");
    expect(fmtMoney(489.775 + 27.5)).toBe("$517"); // the exact sum, for contrast
  });
});
