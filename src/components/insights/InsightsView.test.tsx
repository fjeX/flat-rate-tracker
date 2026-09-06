import { describe, it, expect } from "vitest";
import { sortOpCodes } from "./InsightsView";
import type { OpCodePerformance } from "@/lib/insights";

// ── The op-code table's tie-breakers ───────────────────────────────────────
//
// The primary sort key was fixed to read the DISPLAYED value (an unpaid-rework
// row prints `unpaidUses`, not `uses`). The tie-breakers were not: they still
// read raw `b.uses - a.uses`, so two rows both showing "2 uses" were ordered by
// the invisible 8-vs-3 behind them, and always descending — flipping the arrow
// left the tied block exactly where it was. A sort the reader cannot reproduce
// from what is on screen reads as a broken sort.
function row(over: Partial<OpCodePerformance> & { key: string }): OpCodePerformance {
  return {
    code: over.key.toUpperCase(),
    description: "",
    uses: 0,
    timedUses: 0,
    flagTotal: 0,
    actualTotal: 0,
    ratio: null,
    unpaidHours: 0,
    unpaidUses: 0,
    implausibleUses: 0,
    ...over,
  };
}

// Two unpaid-rework rows. Both DISPLAY 2 uses (unpaidUses); their raw `uses`
// differ 8 vs 3, and their unpaidHours are equal so the hours-bled tie-break
// cannot decide it either.
const RAW_8 = row({
  key: "custom:RAW8",
  uses: 8,
  unpaidUses: 2,
  unpaidHours: 4,
  ratio: null,
});
const RAW_3 = row({
  key: "custom:RAW3",
  uses: 3,
  unpaidUses: 2,
  unpaidHours: 4,
  ratio: null,
});

const keys = (rows: OpCodePerformance[]) => rows.map((r) => r.key);

describe("sortOpCodes tie-breakers", () => {
  it("does not reorder rows by a count the screen never shows", () => {
    // Input order is the only thing left to honour once every visible value
    // ties, and Array#sort is stable — so both inputs keep their order.
    expect(keys(sortOpCodes([RAW_8, RAW_3], "ratio", "desc"))).toEqual([
      "custom:RAW8",
      "custom:RAW3",
    ]);
    expect(keys(sortOpCodes([RAW_3, RAW_8], "ratio", "desc"))).toEqual([
      "custom:RAW3",
      "custom:RAW8",
    ]);
  });

  it("breaks ties by the displayed use count, and follows the arrow", () => {
    // Same shape, but now the DISPLAYED counts differ: 5 vs 2.
    const five = row({ ...RAW_8, key: "custom:FIVE", uses: 5, unpaidUses: 5 });
    const two = row({ ...RAW_3, key: "custom:TWO", uses: 99, unpaidUses: 2 });
    expect(keys(sortOpCodes([two, five], "ratio", "desc"))).toEqual([
      "custom:FIVE",
      "custom:TWO",
    ]);
    // Flip the arrow and the tie-break flips with it. It used to be pinned
    // descending in both directions.
    expect(keys(sortOpCodes([two, five], "ratio", "asc"))).toEqual([
      "custom:TWO",
      "custom:FIVE",
    ]);
  });

  it("orders never-timed rows by displayed uses too", () => {
    // Both values are null (never timed), which lands on the first tie-break.
    const a = row({ key: "custom:A", uses: 9, timedUses: 0 });
    const b = row({ key: "custom:B", uses: 2, timedUses: 0 });
    expect(keys(sortOpCodes([b, a], "ratio", "desc"))).toEqual([
      "custom:A",
      "custom:B",
    ]);
    expect(keys(sortOpCodes([a, b], "ratio", "asc"))).toEqual([
      "custom:B",
      "custom:A",
    ]);
  });
});
