import { describe, it, expect } from "vitest";
import {
  dataRange,
  displayedHours,
  bigJobCoverage,
  bigJobPerformance,
  formatRatio,
  gainBoard,
  isMeasuredLine,
  MIN_MEASURED_HOURS,
  minPlausibleActual,
  leakBoard,
  opCodePerformance,
  opCodeState,
  periodTrend,
  ratioOrder,
  ratioTier,
  weekdayEfficiency,
} from "./insights";
import { buildUnpaidSummary } from "./unpaid-summary";
import type { DayDenom } from "./stats";
import type {
  DailyClock,
  Entry,
  EntryOpCode,
  OpCode,
  UnpaidTime,
} from "./types";

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

  // -------------------------------------------------------------------------
  // Unpaid rework — a null ratio is not the same thing as no data
  // -------------------------------------------------------------------------

  // Real production shape. ALIGN under the Aug 1–15 window: four consecutive
  // days, every line a comeback, 3.3 hours worked and nothing paid. The paid
  // ALIGN lines are all older than the window, so they are simply not here —
  // which is exactly how the window chips exposed the bug.
  const alignComebacks = [
    entry([line({ id: "a1", opCodeId: "oc1", flagHours: 0, actualHours: 0.8, isComeback: true })], { id: "e1", date: "2026-08-01" }),
    entry([line({ id: "a2", opCodeId: "oc1", flagHours: 0, actualHours: 0.8, isComeback: true })], { id: "e2", date: "2026-08-02" }),
    entry([line({ id: "a3", opCodeId: "oc1", flagHours: 0, actualHours: 0.9, isComeback: true })], { id: "e3", date: "2026-08-03" }),
    entry([line({ id: "a4", opCodeId: "oc1", flagHours: 0, actualHours: 0.8, isComeback: true })], { id: "e4", date: "2026-08-04" }),
  ];

  it("reports a comeback-only code as unpaid rework, not as never timed", () => {
    // The regression. Every one of these lines is excluded from the ratio (the
    // flag is zero, there is nothing to divide by) and that is correct — but
    // excluding them from the ROW made the page render "never timed" with
    // dashes for hours, reporting NO DATA for the single most expensive thing
    // it had found. Four days of free work, displayed as nothing to see.
    const rows = opCodePerformance(alignComebacks, library);
    const align = rows.find((r) => r.code === "B12")!;

    expect(align.uses).toBe(4);
    expect(align.unpaidUses).toBe(4);
    expect(align.unpaidHours).toBeCloseTo(3.3, 5);
    expect(opCodeState(align)).toBe("unpaid");
    // Still no ratio, and deliberately no fabricated one.
    expect(align.ratio).toBeNull();
    // The hours reach the page instead of an em-dash.
    expect(displayedHours(align)).toEqual({ flag: 0, actual: align.unpaidHours });
  });

  it("keeps comeback hours out of the ratio on a code that also has paid work", () => {
    // The tempting wrong fix: fold comeback actuals into actualTotal so they
    // show up. That silently corrupts every mixed code — 2.0h of paid work
    // against a 2.0h flag is 1.00×, and adding 1.3h of unpaid rework on top
    // reports 1.65×, accusing the book time of being wrong when the real
    // problem is that the rework was never paid at all.
    const rows = opCodePerformance(
      [
        entry([line({ id: "p", opCodeId: "oc1", flagHours: 2, actualHours: 2 })], { id: "e1" }),
        entry([line({ id: "c", opCodeId: "oc1", flagHours: 0, actualHours: 1.3, isComeback: true })], { id: "e2" }),
      ],
      library,
    );
    const row = rows.find((r) => r.code === "B12")!;

    expect(row.ratio).toBeCloseTo(1, 5); // NOT 3.3 / 2
    expect(row.actualTotal).toBeCloseTo(2, 5);
    expect(row.timedUses).toBe(1);
    // The rework is still counted, it just lives in its own field.
    expect(row.unpaidHours).toBeCloseTo(1.3, 5);
    expect(opCodeState(row)).toBe("measured");
  });

  it("sorts unpaid rework above the worst measured ratio", () => {
    // Real hours against zero flag is an infinite ratio. Nothing measured can
    // be worse, so nothing measured should outrank it — and the old sort put
    // it below everything, under "Show all", where it was never seen.
    const rows = opCodePerformance(
      [
        ...alignComebacks,
        entry([line({ id: "bad", opCodeId: "oc2", flagHours: 1, actualHours: 2.5 })], { id: "e9" }),
      ],
      library,
    );
    expect(rows[0].code).toBe("B12");
    expect(opCodeState(rows[0])).toBe("unpaid");
    expect(rows[1].ratio).toBeCloseTo(2.5, 5);
    expect(ratioOrder(rows[0])).toBe(Number.POSITIVE_INFINITY);
  });

  it("orders two unpaid codes by hours bled, not by how often they came back", () => {
    // Both rank Infinity, and Infinity - Infinity is NaN. NaN is falsy, so a
    // comparator written `Infinity - Infinity || b.uses - a.uses` silently falls
    // through to the use count — which is the wrong answer and looks plausible.
    //
    // So the two orderings are made to DISAGREE here: LOF came back five times
    // for six minutes each, B12 twice for an hour and a half. Five beats two on
    // volume, but 3.0h is the one costing real money. Ordering by uses would be
    // ranking the annoying above the expensive.
    const rows = opCodePerformance(
      [
        ...[1, 2].map((n) =>
          entry([line({ id: `b${n}`, opCodeId: "oc1", flagHours: 0, actualHours: 1.5, isComeback: true })], { id: `eb${n}` }),
        ),
        ...[1, 2, 3, 4, 5].map((n) =>
          entry([line({ id: `l${n}`, opCodeId: "oc2", flagHours: 0, actualHours: 0.1, isComeback: true })], { id: `el${n}` }),
        ),
      ],
      library,
    );
    expect(rows.map((r) => r.code)).toEqual(["B12", "LOF"]);
    expect(rows[0].unpaidHours).toBeCloseTo(3, 5);
    expect(rows[0].uses).toBeLessThan(rows[1].uses); // fewer uses, still first
  });

  it("leaves an untimed comeback as never timed — the rework happened, the clock didn't run", () => {
    // Dashboard Quick Add offers no actual-hours field on a comeback, so this
    // is a real shape. There is genuinely nothing measured to show; counting
    // the use without inventing hours is the honest answer.
    const rows = opCodePerformance(
      [entry([line({ id: "c", opCodeId: "oc1", flagHours: 0, actualHours: null, isComeback: true })])],
      library,
    );
    const row = rows[0];
    expect(row.unpaidUses).toBe(1);
    expect(row.unpaidHours).toBe(0);
    expect(opCodeState(row)).toBe("untimed");
    expect(displayedHours(row)).toBeNull();
  });

  it("does not promote a mis-tapped comeback timer to unpaid rework", () => {
    // Same 0.01h mis-save that caused the 0.00x bug, on a comeback line. The
    // floor is applied to the TOTAL rather than per line, so several mis-taps
    // still cannot add up to a finding.
    const rows = opCodePerformance(
      [
        entry([line({ id: "c1", opCodeId: "oc1", flagHours: 0, actualHours: 0.01, isComeback: true })], { id: "e1" }),
        entry([line({ id: "c2", opCodeId: "oc1", flagHours: 0, actualHours: 0.02, isComeback: true })], { id: "e2" }),
      ],
      library,
    );
    expect(rows[0].unpaidHours).toBeCloseTo(0.03, 5);
    expect(opCodeState(rows[0])).toBe("untimed");
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

  // The /pay-period vs /insights split: 387% against 627% for one fortnight,
  // because four weekend days with flagged work, no clock and no schedule were
  // in this numerator and in nobody's denominator.
  it("pairs the numerator — a day with no denominator is in neither side", () => {
    const points = periodTrend(
      [
        entry([line({ flagHours: 8 })], { id: "wk", date: "2026-07-03" }),
        entry([line({ flagHours: 6 })], { id: "sat", date: "2026-07-04" }),
      ],
      denom({ "2026-07-03": 8 }),
      { splitDay: 15 },
    );
    expect(points).toHaveLength(1);
    expect(points[0].flagHours).toBe(8);
    expect(points[0].denomHours).toBe(8);
    expect(points[0].efficiency).toBeCloseTo(100, 5);
    // Reported, not discarded.
    expect(points[0].unpairedFlagHours).toBe(6);
    expect(points[0].unpairedDays).toBe(1);
  });

  it("counts an unpaired day once no matter how many ROs it holds", () => {
    const points = periodTrend(
      [
        entry([line({ flagHours: 3 })], { id: "a", date: "2026-07-04" }),
        entry([line({ flagHours: 4 })], { id: "b", date: "2026-07-04" }),
        entry([line({ flagHours: 5 })], { id: "c", date: "2026-07-05" }),
      ],
      denom({}),
      { splitDay: 15 },
    );
    expect(points[0].flagHours).toBe(0);
    expect(points[0].efficiency).toBeNull();
    expect(points[0].unpairedFlagHours).toBe(12);
    expect(points[0].unpairedDays).toBe(2);
  });

  // The regression that started this: same entries, same clocks, two surfaces.
  it("agrees with aggregateStatsWithSchedule on a period with weekend work", () => {
    const entries = [
      entry([line({ flagHours: 30 })], { id: "mon", date: "2026-07-06" }),
      entry([line({ flagHours: 12 })], { id: "sat", date: "2026-07-11" }),
    ];
    const points = periodTrend(entries, denom({ "2026-07-06": 8 }), {
      splitDay: 15,
    });
    // Paired: 30 / 8. Unpaired Saturday would have made it 42 / 8.
    expect(points[0].efficiency).toBeCloseTo(375, 5);
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

describe("leakBoard", () => {
  // The disjointness that makes the total a real sum. A comeback flags zero by
  // DB CHECK, so it can never enter flagTotal/actualTotal — the overrun and the
  // rework describe different hours of the same code's life.
  it("reports a code's overrun AND its rework, without counting an hour twice", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", custom: true, customCode: "DIAG", flagHours: 10, actualHours: 16 }),
          line({ id: "b", custom: true, customCode: "DIAG", flagHours: 0, actualHours: 3, isComeback: true }),
        ]),
      ],
      [],
    );
    const board = leakBoard(rows, []);
    expect(board.leaks.map((l) => l.kind).sort()).toEqual(["overrun", "rework"]);
    expect(board.leaks.find((l) => l.kind === "overrun")!.hours).toBeCloseTo(6, 5);
    expect(board.leaks.find((l) => l.kind === "rework")!.hours).toBeCloseTo(3, 5);
    // 6 over book + 3 unpaid = 9. Not 16, not 19 — the actual hours of the
    // timed line are mostly PAID, and only the excess is a leak.
    expect(board.totalHours).toBeCloseTo(9, 5);
  });

  it("keeps rework visible on a code that also has healthy timed lines", () => {
    // The regression this guards: gating on opCodeState made "measured" win, so
    // a code with any ratio at all reported its overrun and silently dropped
    // every unpaid comeback hour attached to it.
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", custom: true, customCode: "BRK", flagHours: 10, actualHours: 10 }),
          line({ id: "b", custom: true, customCode: "BRK", flagHours: 0, actualHours: 2.5, isComeback: true }),
        ]),
      ],
      [],
    );
    const board = leakBoard(rows, []);
    expect(board.leaks).toHaveLength(1);
    expect(board.leaks[0].kind).toBe("rework");
    expect(board.totalHours).toBeCloseTo(2.5, 5);
  });

  it("ranks a pure-rework code by the hours it bled", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", custom: true, customCode: "WARR", flagHours: 0, actualHours: 3.3, isComeback: true }),
        ]),
      ],
      [],
    );
    const board = leakBoard(rows, []);
    expect(board.leaks).toHaveLength(1);
    expect(board.leaks[0].kind).toBe("rework");
    expect(board.leaks[0].hours).toBeCloseTo(3.3, 5);
    expect(board.totalHours).toBeCloseTo(3.3, 5);
  });

  it("never lists a job that beat its book time", () => {
    const rows = opCodePerformance(
      [entry([line({ custom: true, customCode: "FAST", flagHours: 10, actualHours: 7 })])],
      [],
    );
    expect(leakBoard(rows, []).leaks).toHaveLength(0);
    expect(leakBoard(rows, []).totalHours).toBe(0);
  });

  it("ignores a code that was never timed rather than guessing a loss", () => {
    const rows = opCodePerformance(
      [entry([line({ custom: true, customCode: "NEVER", flagHours: 4, actualHours: null })])],
      [],
    );
    expect(leakBoard(rows, []).leaks).toHaveLength(0);
  });

  it("orders worst first", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", custom: true, customCode: "SMALL", flagHours: 10, actualHours: 11 }),
          line({ id: "b", custom: true, customCode: "BIG", flagHours: 10, actualHours: 20 }),
        ]),
      ],
      [],
    );
    const board = leakBoard(rows, []);
    expect(board.leaks.map((l) => l.code)).toEqual(["BIG", "SMALL"]);
    expect(board.totalHours).toBeCloseTo(11, 5);
  });

  it("ranks rework above overrun when the hours AND the uses tie exactly", () => {
    // A tie this exact has never occurred in real data, which is precisely why
    // it needs a test: for as long as the comparator was hours-then-uses, the
    // answer came from Array.prototype.sort's stability and the order the two
    // entries happen to be pushed in — overrun first. That rendered the code's
    // overrun ABOVE its rework, the opposite of the documented rule, and no
    // dataset in the account was ever going to reveal it.
    //
    // One code, one timed line 6h over book (6h, 1 use) and one comeback worth
    // exactly 6h (6h, 1 use). Every field the comparator reads is identical.
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", custom: true, customCode: "TIE", flagHours: 10, actualHours: 16 }),
          line({ id: "b", custom: true, customCode: "TIE", flagHours: 0, actualHours: 6, isComeback: true }),
        ]),
      ],
      [],
    );
    const board = leakBoard(rows, []);
    expect(board.leaks).toHaveLength(2);
    // The precondition — if these drift apart the test stops testing the tie
    // and starts passing for the ordinary hours reason.
    expect(board.leaks[0].hours).toBeCloseTo(board.leaks[1].hours, 5);
    expect(board.leaks[0].uses).toBe(board.leaks[1].uses);
    expect(board.leaks.map((l) => l.kind)).toEqual(["rework", "overrun"]);
  });
});

// ── The ledger half of the leak board ────────────────────────────────────────
// Modelled on dispute-pack.test.ts's "collects comeback lines and ledger rows
// without touching the variance total" — the one existing precedent for
// asserting BOTH of buildUnpaidSummary's sources in one dataset.

function ledgerRow(over: Partial<UnpaidTime> = {}): UnpaidTime {
  return {
    id: "u1",
    userId: "u",
    date: "2026-07-09",
    hours: 3.5,
    kind: "wait_parts",
    entryId: null,
    originalEntryId: null,
    source: "manual",
    note: "",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

/** buildUnpaidSummary's ledger lines, exactly as InsightsView hands them over. */
function ledgerLines(entries: Entry[], unpaid: UnpaidTime[]) {
  return buildUnpaidSummary({ entries, unpaid, library: [] }).lines;
}

describe("leakBoard — unpaid-time ledger rows", () => {
  it("gives waiting-on-parts its own row, which no op code could ever produce", () => {
    // The bug in one assertion: the entries below contain no ledger-shaped work
    // at all, because a ledger row HAS no op code. Before ledger rows were an
    // input, 3.50h of real unpaid time was structurally unreachable here — not
    // filtered out, not rounded away, unreachable.
    const unpaid = [ledgerRow({ hours: 3.5 })];
    const board = leakBoard(opCodePerformance([], []), ledgerLines([], unpaid));
    expect(board.leaks).toHaveLength(1);
    expect(board.leaks[0].code).toBe("Waiting on parts");
    expect(board.leaks[0].kind).toBe("unpaid_clock");
    expect(board.leaks[0].source).toBe("ledger");
    expect(board.leaks[0].uses).toBe(1);
    expect(board.leaks[0].ratio).toBeNull();
    expect(board.totalHours).toBeCloseTo(3.5, 5);
  });

  it("groups by kind rather than listing every entry", () => {
    const unpaid = [
      ledgerRow({ id: "a", hours: 2, kind: "wait_parts", date: "2026-07-09" }),
      ledgerRow({ id: "b", hours: 1.5, kind: "wait_parts", date: "2026-07-10" }),
      ledgerRow({ id: "c", hours: 0.75, kind: "shop_time", date: "2026-07-11" }),
    ];
    const board = leakBoard(opCodePerformance([], []), ledgerLines([], unpaid));
    expect(board.leaks.map((l) => l.code)).toEqual([
      "Waiting on parts",
      "Shop time",
    ]);
    expect(board.leaks[0].hours).toBeCloseTo(3.5, 5);
    expect(board.leaks[0].uses).toBe(2);
  });

  it("files a ticketless comeback as rework, the way buildUnpaidSummary does", () => {
    // Kind, not source, decides what a leak IS. A comeback with no RO behind it
    // is still rework — it just has no op code to hang off — so it must land in
    // the same bucket as the RO-side comeback lines, or the page would have two
    // vocabularies for one thing.
    const unpaid = [ledgerRow({ hours: 1.25, kind: "comeback_other" })];
    const board = leakBoard(opCodePerformance([], []), ledgerLines([], unpaid));
    expect(board.leaks[0].kind).toBe("rework");
    expect(board.leaks[0].source).toBe("ledger");
    expect(board.leaks[0].code).toBe("Comeback — another tech's work");
  });

  it("keeps a sub-six-minute ledger row, which is data and not a mis-tapped timer", () => {
    // MIN_MEASURED_HOURS guards TIMER readings against book time. A ledger row
    // was typed on purpose, so applying that floor here would put the board back
    // out of step with the period's unpaid total for no reason.
    const unpaid = [ledgerRow({ hours: 0.05, kind: "shop_time" })];
    const board = leakBoard(opCodePerformance([], []), ledgerLines([], unpaid));
    expect(board.leaks).toHaveLength(1);
    expect(board.totalHours).toBeCloseTo(0.05, 5);
  });

  it("carries a single shared note as the row's detail, and nothing when they differ", () => {
    const one = leakBoard(
      opCodePerformance([], []),
      ledgerLines([], [ledgerRow({ note: "dealer had none" })]),
    );
    expect(one.leaks[0].description).toBe("dealer had none");

    const many = leakBoard(
      opCodePerformance([], []),
      ledgerLines(
        [],
        [
          ledgerRow({ id: "a", note: "dealer had none" }),
          ledgerRow({ id: "b", note: "wrong part shipped" }),
        ],
      ),
    );
    expect(many.leaks[0].description).toBe("");
  });

  it("does not count an RO comeback twice when the summary carries both sources", () => {
    // buildUnpaidSummary returns BOTH sources; the op-code rows already carry
    // the RO half as their rework row. Reading the whole list would print those
    // hours a second time.
    const entries = [
      entry(
        [line({ id: "b", custom: true, customCode: "BRK", flagHours: 0, actualHours: 2, isComeback: true })],
        { id: "e2", comebackKind: "comeback_own" },
      ),
    ];
    const rows = opCodePerformance(entries, []);
    const board = leakBoard(rows, ledgerLines(entries, []));
    expect(board.leaks).toHaveLength(1);
    expect(board.leaks[0].source).toBe("opcode");
    expect(board.totalHours).toBeCloseTo(2, 5);
  });
});

// ── Reconciliation ───────────────────────────────────────────────────────────

describe("leakBoard reconciles with buildUnpaidSummary", () => {
  // THE TEST WHOSE ABSENCE LET THE BUG LIVE. On 2026-08-18 Insights totalled
  // 3.3h for a period the Pay Period page totalled 6.80h for; on 2026-08-19,
  // 4.8h against 8.20h. Same gap both days, 3.50h, and it was one ledger row.
  //
  // The comparison is against buildUnpaidSummary's OWN total for the same
  // window — not against hand-written constants, which is what let two surfaces
  // drift while both suites stayed green.
  const range = { start: "2026-07-01", end: "2026-07-15" };

  const entries: Entry[] = [
    // Runs long. Its overrun is a leak but NOT unpaid-summary's business — the
    // paid part of an overrunning job is still paid.
    entry([line({ id: "a", custom: true, customCode: "DIAG", flagHours: 10, actualHours: 13 })], {
      id: "e1",
      date: "2026-07-06",
    }),
    // RO-side comeback: zero flag by DB CHECK, 3.3h of real work.
    entry([line({ id: "b", custom: true, customCode: "BRK", flagHours: 0, actualHours: 3.3, isComeback: true })], {
      id: "e2",
      date: "2026-07-08",
      comebackKind: "comeback_own",
    }),
    // Outside the window on purpose.
    entry([line({ id: "c", custom: true, customCode: "BRK", flagHours: 0, actualHours: 7, isComeback: true })], {
      id: "e3",
      date: "2026-07-20",
      comebackKind: "comeback_own",
    }),
  ];

  const unpaid: UnpaidTime[] = [
    ledgerRow({ id: "u1", date: "2026-07-09", hours: 3.5, kind: "wait_parts" }),
    ledgerRow({ id: "u2", date: "2026-07-10", hours: 1, kind: "wait_parts" }),
    ledgerRow({ id: "u3", date: "2026-07-11", hours: 0.75, kind: "shop_time" }),
    ledgerRow({ id: "u4", date: "2026-07-12", hours: 1.25, kind: "comeback_other" }),
    // Outside the window on purpose — big enough that leaking it would be loud.
    ledgerRow({ id: "u5", date: "2026-07-20", hours: 9, kind: "wait_approval" }),
  ];

  // Scoped exactly the way InsightsView scopes it: one range object, one
  // inclusive comparison, applied to both collections.
  const scopedEntries = entries.filter(
    (e) => e.date >= range.start && e.date <= range.end,
  );
  const scopedUnpaid = unpaid.filter(
    (u) => u.date >= range.start && u.date <= range.end,
  );

  const summary = buildUnpaidSummary({
    entries: scopedEntries,
    unpaid: scopedUnpaid,
    library: [],
  });
  const board = leakBoard(
    opCodePerformance(scopedEntries, []),
    summary.lines,
  );

  it("puts the same unpaid hours on the board as the Pay Period list", () => {
    // Overrun is excluded because it is not unpaid time: those hours WERE paid,
    // just not all of them. Everything else on the board must reconcile to the
    // hour, and the expectation is read off the other derivation rather than
    // written down here.
    const unpaidLeakHours = board.leaks
      .filter((l) => l.kind !== "overrun")
      .reduce((sum, l) => sum + l.hours, 0);
    expect(unpaidLeakHours).toBeCloseTo(summary.totalHours, 10);
    // Sanity on the fixture itself: the ledger really is the bigger half, the
    // way it was in production when this was missed.
    expect(summary.totalHours).toBeCloseTo(9.8, 10);
    expect(summary.waitingHours + summary.shopHours).toBeCloseTo(5.25, 10);
  });

  it("reconciles kind by kind, not just in total", () => {
    const hoursOfKind = (kind: "rework" | "unpaid_clock") =>
      board.leaks
        .filter((l) => l.kind === kind)
        .reduce((sum, l) => sum + l.hours, 0);
    // buildUnpaidSummary's comebackHours covers RO comeback lines AND ledger
    // comeback rows; the board's rework kind must cover exactly the same set.
    expect(hoursOfKind("rework")).toBeCloseTo(summary.comebackHours, 10);
    expect(hoursOfKind("unpaid_clock")).toBeCloseTo(
      summary.waitingHours + summary.shopHours,
      10,
    );
  });

  it("honours the window on both sources, not just on entries", () => {
    // A scope applied to entries and forgotten on the ledger is the same class
    // of bug wearing a different hat.
    expect(board.leaks.some((l) => l.code === "Waiting on approval")).toBe(false);
    expect(board.totalHours).toBeCloseTo(9.8 + 3, 10);
  });
});

describe("gainBoard", () => {
  it("reports hours the book paid that the job did not take", () => {
    const rows = opCodePerformance(
      [entry([line({ custom: true, customCode: "BRK", flagHours: 10, actualHours: 7.5 })])],
      [],
    );
    const gains = gainBoard(rows);
    expect(gains).toHaveLength(1);
    expect(gains[0].code).toBe("BRK");
    expect(gains[0].hours).toBeCloseTo(2.5, 5);
  });

  it("excludes overruns and untimed codes", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", custom: true, customCode: "OVER", flagHours: 5, actualHours: 9 }),
          line({ id: "b", custom: true, customCode: "NEVER", flagHours: 5, actualHours: null }),
        ]),
      ],
      [],
    );
    expect(gainBoard(rows)).toHaveLength(0);
  });
});

describe("minPlausibleActual — the relative floor", () => {
  it("keeps the absolute floor in charge of small jobs", () => {
    // 0.3h flag × 0.15 = 0.045, which is below six minutes. The flat floor wins,
    // so nothing about how quick jobs are measured changes.
    expect(minPlausibleActual(0.3)).toBeCloseTo(MIN_MEASURED_HOURS, 5);
    expect(minPlausibleActual(0.5)).toBeCloseTo(MIN_MEASURED_HOURS, 5);
  });

  it("scales with book time once the job is big enough to hide a mis-tap", () => {
    expect(minPlausibleActual(25)).toBeCloseTo(3.75, 5);
    expect(minPlausibleActual(8)).toBeCloseTo(1.2, 5);
  });

  it("rejects every implausible reading found in production", () => {
    // The four real rows that walked through the old absolute-only gate.
    for (const [flag, actual] of [
      [25, 0.12],
      [22, 0.5],
      [8, 0.24],
      [5.4, 0.46],
    ]) {
      expect(isMeasuredLine({ flagHours: flag, actualHours: actual })).toBe(false);
    }
  });

  it("keeps every genuine reading found in production", () => {
    for (const [flag, actual] of [
      [1.8, 0.7],
      [0.3, 0.2],
      [1.5, 1.24],
      [6, 5.5],
    ]) {
      expect(isMeasuredLine({ flagHours: flag, actualHours: actual })).toBe(true);
    }
  });

  it("keeps a genuinely excellent job — beating the book is the job", () => {
    // Liem's water pump: flags 5.0h, done in 1.5h. A 0.30 ratio, and the single
    // most important reading the app can capture. It must never be filtered.
    expect(isMeasuredLine({ flagHours: 5, actualHours: 1.5 })).toBe(true);
    // Even a 4x beat survives.
    expect(isMeasuredLine({ flagHours: 8, actualHours: 2 })).toBe(true);
  });

  it("treats a null actual and a zero flag as unmeasurable, as before", () => {
    expect(isMeasuredLine({ flagHours: 5, actualHours: null })).toBe(false);
    expect(isMeasuredLine({ flagHours: 0, actualHours: 2 })).toBe(false);
  });
});

describe("opCodePerformance — implausible readings", () => {
  it("does not let a mis-saved timer become the biggest win on the page", () => {
    const rows = opCodePerformance(
      [entry([line({ id: "a", opCodeId: "oc1", flagHours: 25, actualHours: 0.12 })])],
      library,
    );
    expect(rows).toHaveLength(1);
    // Not measured, so it cannot reach gainBoard and claim 24.88 saved hours.
    expect(rows[0].ratio).toBeNull();
    expect(rows[0].timedUses).toBe(0);
    expect(gainBoard(rows)).toHaveLength(0);
    expect(leakBoard(rows, []).leaks).toHaveLength(0);
  });

  it("counts the bad reading so the tech can find and fix it", () => {
    const rows = opCodePerformance(
      [entry([line({ id: "a", opCodeId: "oc1", flagHours: 25, actualHours: 0.12 })])],
      library,
    );
    expect(rows[0].implausibleUses).toBe(1);
    // Still "untimed" as a state — there is genuinely no measurement here.
    expect(opCodeState(rows[0])).toBe("untimed");
  });

  it("does not flag a comeback as implausible", () => {
    // A comeback flags zero by DB CHECK. It is unmeasurable by design, not by
    // mistake, and calling it suspect would cry wolf on a correct record.
    const rows = opCodePerformance(
      [entry([line({ id: "a", opCodeId: "oc1", flagHours: 0, actualHours: 1.2, isComeback: true })])],
      library,
    );
    expect(rows[0].implausibleUses).toBe(0);
    expect(rows[0].unpaidHours).toBeCloseTo(1.2, 5);
  });

  it("keeps a good line and rejects a bad one on the same code", () => {
    const rows = opCodePerformance(
      [
        entry([
          line({ id: "a", opCodeId: "oc1", flagHours: 5, actualHours: 4.5 }),
          line({ id: "b", opCodeId: "oc1", flagHours: 5, actualHours: 0.2 }),
        ]),
      ],
      library,
    );
    expect(rows[0].timedUses).toBe(1);
    expect(rows[0].implausibleUses).toBe(1);
    expect(rows[0].ratio).toBeCloseTo(0.9, 5);
  });
});

describe("bigJobPerformance", () => {
  it("keeps only the jobs worth measuring individually", () => {
    const rows = bigJobPerformance(
      [
        entry([
          line({ id: "a", opCodeId: "oc1", flagHours: 5, actualHours: 4 }),
          line({ id: "b", opCodeId: "oc2", flagHours: 0.4, actualHours: 0.3 }),
        ]),
      ],
      library,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ratio).toBeCloseTo(0.8, 5);
  });

  it("does not mix a code's big and small uses into one ratio", () => {
    // Same code used two ways. Filtering after grouping would average a 5h job
    // with a 0.4h one and call the result "that job".
    const rows = bigJobPerformance(
      [
        entry([
          line({ id: "a", opCodeId: "oc1", flagHours: 5, actualHours: 5 }),
          line({ id: "b", opCodeId: "oc1", flagHours: 0.4, actualHours: 0.8 }),
        ]),
      ],
      library,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].timedUses).toBe(1);
    expect(rows[0].ratio).toBeCloseTo(1, 5);
  });

  it("marks a row provisional until it has enough readings", () => {
    const one = bigJobPerformance(
      [entry([line({ id: "a", opCodeId: "oc1", flagHours: 5, actualHours: 4 })])],
      library,
    );
    expect(one[0].confident).toBe(false);
    expect(one[0].needsMore).toBe(2);

    const three = bigJobPerformance(
      [
        entry([
          line({ id: "a", opCodeId: "oc1", flagHours: 5, actualHours: 4 }),
          line({ id: "b", opCodeId: "oc1", flagHours: 5, actualHours: 4 }),
          line({ id: "c", opCodeId: "oc1", flagHours: 5, actualHours: 4 }),
        ]),
      ],
      library,
    );
    expect(three[0].confident).toBe(true);
    expect(three[0].needsMore).toBe(0);
  });

  it("flags a row whose readings include a tapped estimate", () => {
    const rows = bigJobPerformance(
      [
        entry([
          line({
            id: "a",
            opCodeId: "oc1",
            flagHours: 5,
            actualHours: 4,
            actualSource: "estimate",
          }),
        ]),
      ],
      library,
    );
    expect(rows[0].hasEstimate).toBe(true);
  });

  it("does not flag a row measured by the clock", () => {
    const rows = bigJobPerformance(
      [
        entry([
          line({
            id: "a",
            opCodeId: "oc1",
            flagHours: 5,
            actualHours: 4,
            actualSource: "timer",
          }),
        ]),
      ],
      library,
    );
    expect(rows[0].hasEstimate).toBe(false);
  });
});

describe("bigJobCoverage", () => {
  it("reports how much of the big work has a reading behind it", () => {
    const cov = bigJobCoverage([
      entry([
        line({ id: "a", opCodeId: "oc1", flagHours: 5, actualHours: 4 }),
        line({ id: "b", opCodeId: "oc1", flagHours: 5 }),
        line({ id: "c", opCodeId: "oc1", flagHours: 5 }),
        line({ id: "d", opCodeId: "oc2", flagHours: 0.4, actualHours: 0.3 }),
      ]),
    ]);
    // The quick line is not part of the question.
    expect(cov.lines).toBe(3);
    expect(cov.measured).toBe(1);
    expect(cov.pct).toBeCloseTo(33.33, 1);
  });

  it("does not count an impossible reading as coverage", () => {
    const cov = bigJobCoverage([
      entry([line({ id: "a", opCodeId: "oc1", flagHours: 25, actualHours: 0.12 })]),
    ]);
    expect(cov.lines).toBe(1);
    expect(cov.measured).toBe(0);
  });

  it("is zero, not NaN, with no big jobs at all", () => {
    const cov = bigJobCoverage([entry([line({ opCodeId: "oc1", flagHours: 0.4 })])]);
    expect(cov.pct).toBe(0);
  });
});
