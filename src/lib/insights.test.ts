import { describe, it, expect } from "vitest";
import {
  dataRange,
  formatRatio,
  opCodePerformance,
  periodTrend,
  ratioTier,
  weekdayEfficiency,
} from "./insights";
import type { DayDenom } from "./stats";
import type { DailyClock, Entry, EntryOpCode, OpCode } from "./types";

function line(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: over.id ?? "l",
    opCodeId: null,
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

function entry(lines: EntryOpCode[], over: Partial<Entry> = {}): Entry {
  return {
    id: over.id ?? "e",
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date: "2026-07-06",
    roNumber: "1001",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
    ...over,
  };
}

const library: OpCode[] = [
  {
    id: "oc1",
    userId: "u",
    code: "B12",
    description: "Front brakes",
    flagHours: 2,
    notes: "",
    tags: [],
    sortOrder: 0,
    createdAt: "",
    subOpCodes: [
      {
        id: "sub1",
        userId: "u",
        opCodeId: "oc1",
        code: "CER",
        description: "Ceramic",
        flagHours: 2.5,
        sortOrder: 0,
        createdAt: "",
      },
    ],
  },
  {
    id: "oc2",
    userId: "u",
    code: "LOF",
    description: "Lube oil filter",
    flagHours: 0.5,
    notes: "",
    tags: [],
    sortOrder: 1,
    createdAt: "",
    subOpCodes: [],
  },
];

const denom = (map: Record<string, number>): Record<string, DayDenom> =>
  Object.fromEntries(
    Object.entries(map).map(([d, hours]) => [d, { hours, source: "clocked" }]),
  );

describe("opCodePerformance", () => {
  it("takes the ratio from timed lines only", () => {
    const rows = opCodePerformance(
      [
        entry([line({ id: "a", opCodeId: "oc1", flagHours: 2, actualHours: 3 })]),
        entry([line({ id: "b", opCodeId: "oc1", flagHours: 2 })], { id: "e2" }),
        entry([line({ id: "c", opCodeId: "oc1", flagHours: 2 })], { id: "e3" }),
      ],
      library,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].uses).toBe(3);
    expect(rows[0].timedUses).toBe(1);
    expect(rows[0].ratio).toBeCloseTo(1.5, 5);
  });

  it("reports null ratio when a code was never timed", () => {
    const rows = opCodePerformance(
      [entry([line({ opCodeId: "oc2", flagHours: 0.5 })])],
      library,
    );
    expect(rows[0].ratio).toBeNull();
    expect(rows[0].timedUses).toBe(0);
  });

  it("sinks never-timed codes below timed ones however often they're used", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", opCodeId: "oc1", flagHours: 2, actualHours: 2 }),
          line({ id: "b", opCodeId: "oc2", flagHours: 0.5 }),
          line({ id: "c", opCodeId: "oc2", flagHours: 0.5 }),
          line({ id: "d", opCodeId: "oc2", flagHours: 0.5 }),
        ]),
      ],
      library,
    );
    expect(rows.map((r) => r.code)).toEqual(["B12", "LOF"]);
  });

  it("rolls a sub-op-code variant up to its parent, keeping the line's own flag", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", opCodeId: "oc1", flagHours: 2, actualHours: 2 }),
          line({
            id: "b",
            opCodeId: "oc1",
            subOpCodeId: "sub1",
            flagHours: 2.5,
            actualHours: 2.5,
          }),
        ]),
      ],
      library,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("B12");
    expect(rows[0].uses).toBe(2);
    expect(rows[0].flagTotal).toBeCloseTo(4.5, 5); // 2 + 2.5, not 2 + 2
  });

  it("groups custom lines by their own code, not all together", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", custom: true, customCode: "diag", flagHours: 1, actualHours: 2 }),
          line({ id: "b", custom: true, customCode: "DIAG", flagHours: 1, actualHours: 2 }),
          line({ id: "c", custom: true, customCode: "WELD", flagHours: 1, actualHours: 1 }),
        ]),
      ],
      library,
    );
    expect(rows).toHaveLength(2);
    const diag = rows.find((r) => r.code === "DIAG")!;
    expect(diag.uses).toBe(2); // case-insensitive grouping
    expect(rows.find((r) => r.code === "WELD")!.uses).toBe(1);
  });

  it("groups code-less custom lines by description instead of collapsing them", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", custom: true, customDescription: "Sunroof rattle" }),
          line({ id: "b", custom: true, customDescription: "Sunroof rattle" }),
          line({ id: "c", custom: true, customDescription: "Wiper linkage" }),
        ]),
      ],
      library,
    );
    expect(rows).toHaveLength(2);
  });

  it("counts a zero-flag comeback as a use but keeps it out of the ratio", () => {
    // Comeback lines are forced to zero flag by a DB constraint. Dividing by
    // that would make every code that ever came back read as Infinity.
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", opCodeId: "oc1", flagHours: 2, actualHours: 2 }),
          line({ id: "b", opCodeId: "oc1", flagHours: 0, actualHours: 3, isComeback: true }),
        ]),
      ],
      library,
    );
    expect(rows[0].uses).toBe(2);
    expect(rows[0].timedUses).toBe(1);
    expect(rows[0].ratio).toBeCloseTo(1, 5);
    expect(Number.isFinite(rows[0].ratio!)).toBe(true);
  });

  it("treats a zero actual as never timed, not as an instant job", () => {
    // Real data: a timer saved with nothing on it writes actual_hours = 0. Read
    // as a measurement it renders "0.00×" — a job that costs no time at all —
    // and outranks every genuine reading on the page.
    const rows = opCodePerformance(
      [entry([line({ id: "a", opCodeId: "oc1", flagHours: 2, actualHours: 0 })])],
      library,
    );
    expect(rows[0].uses).toBe(1);
    expect(rows[0].timedUses).toBe(0);
    expect(rows[0].ratio).toBeNull();
  });

  it("treats a tapped-and-saved timer as never timed, not as an instant job", () => {
    // The 0.01 case, which is the one that actually shipped. actual_hours is
    // numeric(5,2), so a mis-saved timer lands on 0.01 rather than exactly 0 and
    // clears a `> 0` guard — this is production data: 36 seconds recorded
    // against a 14-hour head gasket.
    const rows = opCodePerformance(
      [entry([line({ id: "a", opCodeId: "oc1", flagHours: 14, actualHours: 0.01 })])],
      library,
    );
    expect(rows[0].uses).toBe(1);
    expect(rows[0].timedUses).toBe(0);
    expect(rows[0].ratio).toBeNull();
  });

  it("keeps a genuinely fast job — a low ratio is a result, not a fault", () => {
    // The floor must not swallow beating book time. 0.30h against a 0.30h flag
    // is the smallest real measurement in production and reads 1.00×; a tech
    // who halves a job should still see 0.50×.
    const rows = opCodePerformance(
      [
        entry([line({ id: "a", opCodeId: "oc1", flagHours: 0.3, actualHours: 0.3 })]),
        entry([line({ id: "b", opCodeId: "oc2", flagHours: 4, actualHours: 2 })], {
          id: "e2",
        }),
      ],
      library,
    );
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(byCode.get("B12")!.ratio).toBeCloseTo(1, 5);
    expect(byCode.get("LOF")!.ratio).toBeCloseTo(0.5, 5);
  });

  it("never lets a surviving ratio display as 0.00", () => {
    // The invariant, checked at the boundary the page actually renders. The
    // per-line floor is not enough on its own: it is per line, the ratio is an
    // aggregate, and one floor-value line against a large flag total still
    // rounds to zero at two decimals.
    expect(formatRatio(0.1 / 74)).toBe("<0.01");
    expect(formatRatio(0.004)).toBe("<0.01");
    expect(formatRatio(0.01)).toBe("0.01");
    expect(formatRatio(1)).toBe("1.00");
    expect(formatRatio(1.43)).toBe("1.43");
  });

  it("keeps lines pointing at a deleted library code separate", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", opCodeId: "gone-1", flagHours: 1, actualHours: 1 }),
          line({ id: "b", opCodeId: "gone-2", flagHours: 1, actualHours: 3 }),
        ]),
      ],
      library,
    );
    expect(rows).toHaveLength(2);
  });

  it("returns an empty array for no entries", () => {
    expect(opCodePerformance([], library)).toEqual([]);
  });
});

describe("ratioTier", () => {
  it("treats LOWER as better — the inverse of efficiencyTier", () => {
    expect(ratioTier(1.0)).toBe("good");
    expect(ratioTier(1.05)).toBe("good");
    expect(ratioTier(1.2)).toBe("warn");
    expect(ratioTier(1.4)).toBe("bad");
    expect(ratioTier(null)).toBeNull();
  });
});

describe("weekdayEfficiency", () => {
  it("files a date under its LOCAL weekday", () => {
    // 2026-07-06 is a Monday. Parsing it as UTC midnight files it as Sunday for
    // anyone west of Greenwich, which is every US user.
    const rows = weekdayEfficiency(
      [entry([line({ flagHours: 8 })], { date: "2026-07-06" })],
      denom({ "2026-07-06": 8 }),
    );
    expect(rows[1].days).toBe(1); // Monday
    expect(rows[0].days).toBe(0); // not Sunday
    expect(rows[1].efficiency).toBeCloseTo(100, 5);
  });

  it("ignores days with no denominator, however much they flagged", () => {
    const rows = weekdayEfficiency(
      [
        entry([line({ flagHours: 12 })], { id: "e1", date: "2026-07-07" }), // no clock
        entry([line({ flagHours: 8 })], { id: "e2", date: "2026-07-06" }),
      ],
      denom({ "2026-07-06": 8 }),
    );
    expect(rows[2].days).toBe(0); // Tuesday never counted
    expect(rows[1].efficiency).toBeCloseTo(100, 5);
  });

  it("counts a clocked day with no work as the zero it was", () => {
    const rows = weekdayEfficiency([], denom({ "2026-07-06": 8 }));
    expect(rows[1].days).toBe(1);
    expect(rows[1].efficiency).toBe(0);
  });

  it("averages across every instance of that weekday", () => {
    const rows = weekdayEfficiency(
      [
        entry([line({ flagHours: 8 })], { id: "e1", date: "2026-07-06" }),
        entry([line({ flagHours: 4 })], { id: "e2", date: "2026-07-13" }),
      ],
      denom({ "2026-07-06": 8, "2026-07-13": 8 }),
    );
    expect(rows[1].days).toBe(2);
    expect(rows[1].flagHours).toBeCloseTo(12, 5);
    expect(rows[1].efficiency).toBeCloseTo(75, 5);
  });

  it("returns 7 rows with null efficiency and no NaN when empty", () => {
    const rows = weekdayEfficiency([], {});
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.efficiency).toBeNull();
      expect(Number.isNaN(row.flagHours)).toBe(false);
      expect(Number.isNaN(row.denomHours)).toBe(false);
    }
  });
});

describe("periodTrend", () => {
  it("buckets by pay period, oldest first", () => {
    const points = periodTrend(
      [
        entry([line({ flagHours: 10 })], { id: "e1", date: "2026-07-03" }),
        entry([line({ flagHours: 20 })], { id: "e2", date: "2026-07-20" }),
      ],
      denom({ "2026-07-03": 8, "2026-07-20": 8 }),
      { splitDay: 15 },
    );
    expect(points.map((p) => p.key)).toEqual(["2026-07-P1", "2026-07-P2"]);
    expect(points[0].efficiency).toBeCloseTo(125, 5);
    expect(points[1].efficiency).toBeCloseTo(250, 5);
  });

  it("includes a period that was clocked but flagged nothing", () => {
    const points = periodTrend(
      [entry([line({ flagHours: 10 })], { date: "2026-07-03" })],
      denom({ "2026-07-03": 8, "2026-07-20": 8 }),
      { splitDay: 15 },
    );
    expect(points).toHaveLength(2);
    expect(points[1].flagHours).toBe(0);
    expect(points[1].efficiency).toBe(0);
  });

  it("honors period overrides, including the drifted-boundary handoff", () => {
    const points = periodTrend(
      [entry([line({ flagHours: 8 })], { date: "2026-07-31" })],
      denom({ "2026-07-31": 8 }),
      {
        splitDay: 14,
        periodOverrides: {
          "2026-07-P2": { start: "2026-07-15", end: "2026-07-30" },
        },
      },
    );
    // Jul 31 belongs to the next period, not the one that closed on the 30th.
    expect(points.map((p) => p.key)).toEqual(["2026-08-P1"]);
  });

  it("keeps only the most recent `limit` periods", () => {
    const entries = [
      entry([line({ flagHours: 1 })], { id: "a", date: "2026-01-05" }),
      entry([line({ flagHours: 1 })], { id: "b", date: "2026-02-05" }),
      entry([line({ flagHours: 1 })], { id: "c", date: "2026-03-05" }),
    ];
    const points = periodTrend(entries, {}, { splitDay: 15, limit: 2 });
    expect(points.map((p) => p.key)).toEqual(["2026-02-P1", "2026-03-P1"]);
  });

  it("returns an empty array with nothing logged", () => {
    expect(periodTrend([], {}, { splitDay: 15 })).toEqual([]);
  });
});

describe("dataRange", () => {
  it("spans entries and clocks together", () => {
    const clocks: DailyClock[] = [
      { userId: "u", date: "2026-06-01", hours: 8 },
      { userId: "u", date: "2026-07-01", hours: 8 },
    ];
    const range = dataRange(
      [entry([line()], { date: "2026-08-15" })],
      clocks,
    );
    expect(range).toEqual({ start: "2026-06-01", end: "2026-08-15" });
  });

  it("is null when there is nothing at all", () => {
    expect(dataRange([], [])).toBeNull();
  });
});

describe("periodTrend — in-progress periods", () => {
  it("carries the period end so a caller can tell finished from running", () => {
    const points = periodTrend(
      [entry([line({ flagHours: 8 })], { date: "2026-07-03" })],
      denom({ "2026-07-03": 8 }),
      { splitDay: 15 },
    );
    expect(points[0].end).toBe("2026-07-15");
  });
});
