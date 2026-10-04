import { describe, it, expect } from "vitest";
import {
  barRankSentence,
  competitionRank,
  jobRankSentence,
  jobRankSentences,
  lineKey,
  ordinal,
  toJobTimings,
} from "./rankings";
import type { Entry, EntryOpCode } from "./types";

function line(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: "l",
    opCodeId: "oc-brk",
    custom: false,
    customCode: null,
    customDescription: null,
    flagHours: 2,
    actualHours: 1,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    isComeback: false,
    ...over,
  } as EntryOpCode;
}
function entry(id: string, lines: EntryOpCode[]): Entry {
  return { id, date: "2026-08-01", opCodes: lines } as unknown as Entry;
}

describe("ordinal", () => {
  it.each([
    [1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [10, "10th"],
    [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"],
    [23, "23rd"], [101, "101st"], [111, "111th"], [112, "112th"],
  ])("%i -> %s", (n, s) => expect(ordinal(n)).toBe(s));
});

describe("competitionRank", () => {
  it("shares a rank on ties and skips the next (1224)", () => {
    const pool = [1, 2, 2, 3];
    expect(competitionRank(2, pool, "low")).toEqual({ rank: 2, tied: true, of: 4 });
    expect(competitionRank(3, pool, "low")).toEqual({ rank: 4, tied: false, of: 4 });
  });
  it("treats float noise as a tie", () => {
    expect(competitionRank(0.75, [1.5 / 2, 0.75, 0.9], "low").tied).toBe(true);
  });
});

describe("jobRankSentence", () => {
  const nine = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3];
  it("says nothing under 3 jobs", () => {
    expect(jobRankSentence(0.5, [0.5, 0.6], "BRK-F")).toBeNull();
  });
  it("middle of the pack", () => {
    expect(jobRankSentence(0.7, nine, "BRK-F")).toBe("3rd fastest of 9 BRK-F jobs you've timed");
  });
  it("fastest and slowest, neutrally", () => {
    expect(jobRankSentence(0.5, nine, "BRK-F")).toBe("Your fastest of 9 BRK-F jobs you've timed");
    expect(jobRankSentence(1.3, nine, "BRK-F")).toBe("Slowest of 9 BRK-F jobs you've timed");
  });
  it("ties share a rank", () => {
    expect(jobRankSentence(0.6, [0.5, 0.6, 0.6, 0.9], "ALIGN")).toBe(
      "Tied 2nd fastest of 4 ALIGN jobs you've timed",
    );
    expect(jobRankSentence(0.5, [0.5, 0.5, 0.9], "ALIGN")).toBe(
      "Tied for fastest of 3 ALIGN jobs you've timed",
    );
  });
  it("handles an all-equal pool", () => {
    expect(jobRankSentence(1, [1, 1, 1], "X")).toBe("Same pace on all 3 X jobs you've timed");
  });
  it("names a non-all-time pool", () => {
    expect(jobRankSentence(0.7, nine, "BRK-F", "in the last 90 days")).toBe(
      "3rd fastest of 9 BRK-F jobs you've timed in the last 90 days",
    );
  });
  it("is deterministic regardless of pool order", () => {
    const shuffled = [...nine].reverse();
    expect(jobRankSentence(0.7, shuffled, "BRK-F")).toBe(jobRankSentence(0.7, nine, "BRK-F"));
  });
});

describe("barRankSentence", () => {
  it("ranks higher efficiency as better", () => {
    const pool = [60, 70, 80, 90];
    expect(barRankSentence(80, pool, "week")).toBe("2nd highest efficiency of 4 weeks");
    expect(barRankSentence(90, pool, "week")).toBe("Highest efficiency of 4 weeks");
    expect(barRankSentence(60, pool, "pay period", "last 90d")).toBe(
      "4th highest efficiency of 4 pay periods, last 90d",
    );
  });
  it("needs 3 bars", () => expect(barRankSentence(80, [80, 90], "day")).toBeNull());
});

describe("line keying and pools", () => {
  it("keeps library and custom codes apart, variants on the parent", () => {
    expect(lineKey(line())).toBe("lib:oc-brk");
    expect(lineKey(line({ subOpCodeId: "sub-1" }))).toBe("lib:oc-brk");
    expect(lineKey(line({ custom: true, opCodeId: null, customCode: " brk-f " }))).toBe(
      "custom:BRK-F",
    );
  });

  it("only times plausible lines (shared isMeasuredLine)", () => {
    const t = toJobTimings([
      entry("a", [
        line({ id: "1", actualHours: 1 }),
        line({ id: "2", actualHours: null }),
        line({ id: "3", actualHours: 0.05 }), // a mis-tap
        line({ id: "4", flagHours: 0, actualHours: 1, isComeback: true }),
      ]),
    ]);
    expect(t).toHaveLength(1);
    expect(t[0].ratio).toBe(0.5);
  });

  it("ranks by ratio, so different book times compare fairly, using this RO live", () => {
    const others = [
      entry("a", [line({ id: "a1", flagHours: 2, actualHours: 1.0 })]), // 0.50
      entry("b", [line({ id: "b1", flagHours: 1.5, actualHours: 1.5 })]), // 1.00
      entry("c", [line({ id: "c1", flagHours: 2, actualHours: 3.0 })]), // 1.50
    ];
    // This RO is also in the pool with a STALE actual; the live line must win.
    const mine = entry("me", [line({ id: "m1", flagHours: 2, actualHours: 1.6 })]); // 0.80
    const stale = [
      ...toJobTimings(others),
      ...toJobTimings([entry("me", [line({ id: "m1", flagHours: 2, actualHours: 9 })])]),
    ];
    const s = jobRankSentences(mine, stale, () => "BRK-F");
    expect(s.get("m1")).toBe("2nd fastest of 4 BRK-F jobs you've timed");
  });

  it("skips codeless lines and thin pools", () => {
    const mine = entry("me", [line({ id: "m1" })]);
    expect(jobRankSentences(mine, [], () => "BRK-F").size).toBe(0);
    const timings = toJobTimings([entry("a", [line()]), entry("b", [line()])]);
    expect(jobRankSentences(mine, timings, () => null).size).toBe(0);
  });
});

describe("barRankSentence ties on the shown percent", () => {
  it("two bars that both read 96% are tied", () =>
    expect(barRankSentence(96, [99, 96, 96, 80], "week")).toBe(
      "Tied 2nd highest efficiency of 4 weeks",
    ));
});
