import { describe, it, expect } from "vitest";
import {
  correlation,
  dayShapes,
  driverStrength,
  HEAVY_FLAG_HOURS,
  MIN_DAYS_FOR_BANDS,
  mixBands,
  mixDrivers,
  mixSummary,
  QUICK_FLAG_HOURS,
  leadDriver,
  rankedDrivers,
  type DayShape,
} from "./mix";
import type { DayDenom } from "./stats";
import type { Entry, EntryOpCode } from "./types";

function line(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: over.id ?? "l",
    opCodeId: "oc1",
    custom: false,
    customCode: null,
    customDescription: null,
    flagHours: 1,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours: null,
    ...over,
  };
}

function entry(date: string, lines: EntryOpCode[], id = date): Entry {
  return {
    id,
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date,
    roNumber: id,
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
  };
}

const denoms = (map: Record<string, number>): Record<string, DayDenom> =>
  Object.fromEntries(
    Object.entries(map).map(([d, hours]) => [
      d,
      { hours, source: "clocked" as const },
    ]),
  );

/** N days, each carrying `heavy` big lines and `quick` small ones. */
function syntheticDays(
  n: number,
  shape: (i: number) => { heavy: number; quick: number },
): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < n; i++) {
    const date = `2026-06-${String(i + 1).padStart(2, "0")}`;
    const { heavy, quick } = shape(i);
    const lines: EntryOpCode[] = [];
    for (let h = 0; h < heavy; h++) {
      lines.push(line({ id: `h${i}${h}`, flagHours: 5 }));
    }
    for (let q = 0; q < quick; q++) {
      lines.push(line({ id: `q${i}${q}`, flagHours: 0.4 }));
    }
    out.push(entry(date, lines, `e${i}`));
  }
  return out;
}

describe("dayShapes", () => {
  it("classifies lines by size and totals the day", () => {
    const days = dayShapes(
      [
        entry("2026-06-01", [
          line({ id: "a", flagHours: 5 }), // heavy
          line({ id: "b", flagHours: 2 }), // heavy — the boundary is inclusive
          line({ id: "c", flagHours: 1.2 }), // neither
          line({ id: "d", flagHours: 0.5 }), // quick — boundary inclusive
          line({ id: "e", flagHours: 0.3 }), // quick
        ]),
      ],
      {},
    );
    expect(days).toHaveLength(1);
    expect(days[0].lines).toBe(5);
    expect(days[0].heavyLines).toBe(2);
    expect(days[0].heavyFlagHours).toBeCloseTo(7, 5);
    expect(days[0].quickLines).toBe(2);
    expect(days[0].flagHours).toBeCloseTo(9, 5);
  });

  it("does not count a comeback as a quick job", () => {
    // A comeback flags zero. Counting it as quick maintenance would make a day
    // of free rework read as a day of easy money.
    const days = dayShapes(
      [
        entry("2026-06-01", [
          line({ id: "a", flagHours: 0, isComeback: true, actualHours: 1.5 }),
          line({ id: "b", flagHours: 0.4 }),
        ]),
      ],
      {},
    );
    expect(days[0].quickLines).toBe(1);
    expect(days[0].lines).toBe(2);
    expect(days[0].flagHours).toBeCloseTo(0.4, 5);
  });

  it("includes a day the tech was present but flagged nothing", () => {
    // The most extreme mix there is, and it has no RO to be found by.
    const days = dayShapes([], denoms({ "2026-06-02": 8 }));
    expect(days).toHaveLength(1);
    expect(days[0].flagHours).toBe(0);
    expect(days[0].denomHours).toBe(8);
    expect(days[0].efficiency).toBe(0);
  });

  it("leaves efficiency null when the day's length is unknown", () => {
    const days = dayShapes([entry("2026-06-01", [line({ flagHours: 4 })])], {});
    expect(days[0].denomHours).toBeNull();
    expect(days[0].efficiency).toBeNull();
  });

  it("returns days in date order", () => {
    const days = dayShapes(
      [
        entry("2026-06-05", [line({ id: "a" })], "e1"),
        entry("2026-06-01", [line({ id: "b" })], "e2"),
      ],
      {},
    );
    expect(days.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-05"]);
  });
});

describe("mixBands", () => {
  it("refuses to build quartiles from too little history", () => {
    const days = dayShapes(syntheticDays(MIN_DAYS_FOR_BANDS - 1, () => ({
      heavy: 1,
      quick: 2,
    })), {});
    expect(mixBands(days)).toBeNull();
  });

  it("splits without leaving a remainder band of one", () => {
    const days = dayShapes(
      syntheticDays(13, (i) => ({ heavy: i % 3, quick: 2 })),
      {},
    );
    const bands = mixBands(days);
    expect(bands).not.toBeNull();
    expect(bands!.map((b) => b.days).reduce((a, b) => a + b, 0)).toBe(13);
    // No band may be empty, and none may hoover up the remainder.
    for (const band of bands!) expect(band.days).toBeGreaterThanOrEqual(3);
  });

  it("orders bands quietest to biggest", () => {
    const days = dayShapes(
      syntheticDays(16, (i) => ({ heavy: Math.floor(i / 4), quick: 2 })),
      {},
    );
    const bands = mixBands(days)!;
    expect(bands.map((b) => b.quartile)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].avgFlagHours).toBeGreaterThanOrEqual(
        bands[i - 1].avgFlagHours,
      );
    }
  });

  it("reproduces the production finding: heavy lines drive the spread, quick ones don't", () => {
    // Modelled on Christian's 37 days — quick-job count held flat while heavy
    // lines climb. If this ever stops holding, the page's headline is wrong.
    const days = dayShapes(
      syntheticDays(16, (i) => ({ heavy: Math.floor(i / 4), quick: 3 })),
      {},
    );
    const bands = mixBands(days)!;
    expect(bands[0].avgHeavyLines).toBeLessThan(bands[3].avgHeavyLines);
    expect(bands[0].avgQuickLines).toBeCloseTo(bands[3].avgQuickLines, 5);
    expect(bands[3].avgFlagHours).toBeGreaterThan(bands[0].avgFlagHours * 2);
  });

  it("reports what share of a band's flag came from heavy lines", () => {
    const days = dayShapes(
      syntheticDays(12, () => ({ heavy: 1, quick: 5 })),
      {},
    );
    const bands = mixBands(days)!;
    // 5.0 heavy against 5.0 + 2.0 quick = 7.0 total.
    expect(bands[0].pctFlagFromHeavy).toBeCloseTo((5 / 7) * 100, 3);
  });

  it("does not divide by zero on a band of flagless days", () => {
    const days = dayShapes([], denoms(
      Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `2026-06-${String(i + 1).padStart(2, "0")}`,
          8,
        ]),
      ),
    ));
    const bands = mixBands(days)!;
    for (const band of bands) expect(band.pctFlagFromHeavy).toBe(0);
  });
});

describe("correlation", () => {
  it("finds a perfect positive relationship", () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it("finds a perfect negative relationship", () => {
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it("returns null when one series never varies", () => {
    // Not zero. "No variation to relate" and "no relationship" are different
    // answers, and only one of them should be printed as a finding.
    expect(correlation([2, 2, 2, 2], [1, 5, 3, 9])).toBeNull();
  });

  it("returns null on mismatched or trivial input", () => {
    expect(correlation([1, 2], [1])).toBeNull();
    expect(correlation([1], [1])).toBeNull();
  });
});

describe("mixDrivers", () => {
  it("withholds every correlation until there is enough history", () => {
    const days = dayShapes(syntheticDays(9, () => ({ heavy: 1, quick: 1 })), {});
    const drivers = mixDrivers(days);
    expect(drivers.drivers).toBeNull();
    expect(drivers.days).toBe(9);
  });

  it("ranks heavy lines above quick ones when heavy lines drive the day", () => {
    const days = dayShapes(
      syntheticDays(16, (i) => ({ heavy: i % 4, quick: 3 })),
      {},
    );
    const drivers = mixDrivers(days).drivers!;
    const heavy = drivers.find((d) => d.key === "heavyLines")!;
    const quick = drivers.find((d) => d.key === "quickLines")!;
    expect(heavy.r).toBeGreaterThan(0.9);
    // Quick count is constant here, so its correlation is undefined, not zero.
    expect(quick.r).toBeNull();
  });

  it("reports a genuinely weak quick-job relationship as weak, not absent", () => {
    const days = dayShapes(
      syntheticDays(20, (i) => ({ heavy: i % 5, quick: (i * 7) % 4 })),
      {},
    );
    const quick = mixDrivers(days).drivers!.find((d) => d.key === "quickLines")!;
    expect(quick.r).not.toBeNull();
    expect(Math.abs(quick.r!)).toBeLessThan(0.5);
  });
});

describe("driverStrength", () => {
  it("uses conventional cut points in both directions", () => {
    expect(driverStrength(0.7)).toBe("strong");
    expect(driverStrength(-0.7)).toBe("strong");
    expect(driverStrength(0.4)).toBe("moderate");
    expect(driverStrength(0.2)).toBe("weak");
    expect(driverStrength(0.03)).toBe("none");
    expect(driverStrength(null)).toBeNull();
  });
});

describe("mixSummary", () => {
  it("is null without a full set of bands", () => {
    expect(mixSummary(null, { days: 0, drivers: null })).toBeNull();
  });

  it("summarises the gap between a quiet day and a big one", () => {
    const days = dayShapes(
      syntheticDays(20, (i) => ({ heavy: i % 5, quick: (i * 7) % 4 })),
      {},
    );
    const summary = mixSummary(mixBands(days), mixDrivers(days))!;
    expect(summary.bestFlagHours).toBeGreaterThan(summary.worstFlagHours);
    expect(summary.spreadHours).toBeCloseTo(
      summary.bestFlagHours - summary.worstFlagHours,
      5,
    );
    expect(summary.bestHeavyLines).toBeGreaterThan(summary.worstHeavyLines);
    expect(summary.quickJobsDontMove).toBe(true);
  });

  it("does NOT claim quick jobs are irrelevant when the tech's data disagrees", () => {
    // A tech whose day really is built out of quick jobs must never be told
    // otherwise. The claim is gated on their own correlation, not on ours.
    const days = dayShapes(
      syntheticDays(20, (i) => ({ heavy: 0, quick: i })),
      {},
    );
    const summary = mixSummary(mixBands(days), mixDrivers(days))!;
    expect(summary.quickJobsDontMove).toBe(false);
  });
});

describe("thresholds", () => {
  it("keeps the heavy/quick bands from overlapping", () => {
    expect(QUICK_FLAG_HOURS).toBeLessThan(HEAVY_FLAG_HOURS);
  });

  it("classifies a line exactly on each boundary the inclusive way", () => {
    const shape = (flagHours: number): DayShape =>
      dayShapes([entry("2026-06-01", [line({ flagHours })])], {})[0];
    expect(shape(HEAVY_FLAG_HOURS).heavyLines).toBe(1);
    expect(shape(HEAVY_FLAG_HOURS - 0.01).heavyLines).toBe(0);
    expect(shape(QUICK_FLAG_HOURS).quickLines).toBe(1);
    expect(shape(QUICK_FLAG_HOURS + 0.01).quickLines).toBe(0);
  });
});

describe("rankedDrivers / leadDriver", () => {
  const d = (key: string, r: number | null) =>
    ({ key, label: key, r }) as never;

  it("pins an undefined correlation last, not first", () => {
    // Math.abs(null ?? -1) scores a NULL as 1.0, which floated the one driver
    // with nothing to say above the ones that did.
    const out = rankedDrivers([d("a", null), d("b", 0.9), d("c", 0.3)]);
    expect(out.map((x) => x.key)).toEqual(["b", "c", "a"]);
  });

  it("ranks a strong negative relationship as strongly as a positive one", () => {
    const out = rankedDrivers([d("a", 0.2), d("b", -0.8)]);
    expect(out.map((x) => x.key)).toEqual(["b", "a"]);
  });

  it("highlights nothing when the strongest driver is undefined", () => {
    expect(leadDriver([d("a", null)])).toBeNull();
    expect(leadDriver([])).toBeNull();
  });

  it("highlights the strongest measurable driver", () => {
    expect(leadDriver([d("a", null), d("b", 0.7)])?.key).toBe("b");
  });
});
