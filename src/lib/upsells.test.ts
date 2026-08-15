import { describe, it, expect } from "vitest";
import {
  topUpsoldCodes,
  upsellByPeriod,
  upsellFlagHours,
  upsellSummary,
} from "./upsells";
import { aggregateStats } from "./stats";
import type { Entry, EntryOpCode, OpCode } from "./types";

let seq = 0;

function line(overrides: Partial<EntryOpCode> = {}): EntryOpCode {
  seq += 1;
  return {
    id: `L${seq}`,
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
    ...overrides,
  };
}

function entry(date: string, lines: EntryOpCode[], id = `E${date}-${seq}`): Entry {
  return {
    id,
    userId: "U",
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
    date,
    roNumber: "12345",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    // Mirrors the DB trigger, which recomputes entries.flag_hours from the lines.
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
    opCodes: lines,
  };
}

describe("upsellFlagHours", () => {
  it("values an upsell at its BOOK time, not the time it took", () => {
    // Flag, not actual: an upsell is a sale. What it cost you to perform is the
    // efficiency question and belongs to a different figure entirely.
    const e = entry("2026-08-14", [
      line({ isUpsell: true, flagHours: 2.5, actualHours: 4 }),
    ]);
    expect(upsellFlagHours(e)).toBe(2.5);
  });

  it("ignores lines nobody marked", () => {
    const e = entry("2026-08-14", [
      line({ flagHours: 3 }),
      line({ isUpsell: false, flagHours: 2 }),
    ]);
    expect(upsellFlagHours(e)).toBe(0);
  });
});

describe("upsellSummary", () => {
  it("reports the sold hours as a SHARE of everything flagged", () => {
    const entries = [
      entry("2026-08-14", [
        line({ flagHours: 6 }),
        line({ isUpsell: true, flagHours: 2 }),
      ]),
      entry("2026-08-15", [line({ flagHours: 2 })]),
    ];
    const s = upsellSummary(entries);
    expect(s.upsellHours).toBe(2);
    expect(s.flagHours).toBe(10);
    expect(s.share).toBeCloseTo(0.2);
  });

  it("counts ROs that hold an upsell, not upsold lines, for roCount", () => {
    const entries = [
      entry("2026-08-14", [
        line({ isUpsell: true, flagHours: 1 }),
        line({ isUpsell: true, flagHours: 1 }),
      ]),
      entry("2026-08-15", [line({ flagHours: 4 })]),
    ];
    const s = upsellSummary(entries);
    expect(s.lineCount).toBe(2);
    expect(s.roCount).toBe(1);
  });

  it("share is null with no work at all, never 0%", () => {
    // "You sold none of what you did" and "you did nothing" are different
    // answers. Reporting an empty fortnight as 0% invents a bad month out of
    // time off, and 0/0 would otherwise render as NaN%.
    expect(upsellSummary([]).share).toBeNull();
    expect(upsellSummary([entry("2026-08-14", [])]).share).toBeNull();
  });

  it("survives an upsold line that flags nothing", () => {
    const s = upsellSummary([
      entry("2026-08-14", [line({ isUpsell: true, flagHours: 0 })]),
    ]);
    expect(s.upsellHours).toBe(0);
    expect(s.lineCount).toBe(1);
    expect(s.share).toBeNull();
  });

  it("never exceeds 100%, even when every line was sold", () => {
    const s = upsellSummary([
      entry("2026-08-14", [
        line({ isUpsell: true, flagHours: 3 }),
        line({ isUpsell: true, flagHours: 1 }),
      ]),
    ]);
    expect(s.share).toBe(1);
  });
});

describe("the Pay Period figure and the /insights trend agree", () => {
  // The whole reason upsellFlagHours exists as a shared primitive. These two
  // surfaces reach the number by different routes — aggregateStats filters by
  // date range, upsellByPeriod buckets by pay period — and a tech looking at
  // both at once must not see two answers to one question.
  const SPLIT = 15;
  const entries = [
    entry("2026-08-02", [
      line({ flagHours: 4 }),
      line({ isUpsell: true, flagHours: 1.5 }),
    ]),
    entry("2026-08-09", [line({ isUpsell: true, flagHours: 2 })]),
    entry("2026-08-20", [line({ flagHours: 3 })]),
  ];

  it("reports the same upsold hours for the same period", () => {
    const stats = aggregateStats(entries, [], {
      start: "2026-08-01",
      end: "2026-08-15",
    });
    const trend = upsellByPeriod(entries, { splitDay: SPLIT });
    const p1 = trend.find((p) => p.key === "2026-08-P1");

    expect(stats.upsellHours).toBe(3.5);
    expect(p1?.upsellHours).toBe(3.5);
    expect(p1?.flagHours).toBe(stats.flagHours);
  });

  it("keeps upsold hours INSIDE the flag total, never added to it", () => {
    const stats = aggregateStats(entries, [], {
      start: "2026-08-01",
      end: "2026-08-15",
    });
    // 4 + 1.5 + 2 — the upsold hours are part of this, not extra.
    expect(stats.flagHours).toBe(7.5);
    expect(stats.upsellHours).toBeLessThanOrEqual(stats.flagHours);
  });
});

describe("upsellByPeriod", () => {
  const SPLIT = 15;

  it("buckets by pay period, oldest first", () => {
    const points = upsellByPeriod(
      [
        entry("2026-07-20", [line({ isUpsell: true, flagHours: 1 })]),
        entry("2026-08-02", [line({ isUpsell: true, flagHours: 2 })]),
      ],
      { splitDay: SPLIT },
    );
    expect(points.map((p) => p.key)).toEqual(["2026-07-P2", "2026-08-P1"]);
    expect(points.map((p) => p.upsellHours)).toEqual([1, 2]);
  });

  it("keeps a worked period with no upsells — that is the finding", () => {
    // Dropping it would hide the months where nothing was sold, which is the
    // comparison the whole section exists to make.
    const points = upsellByPeriod(
      [
        entry("2026-07-20", [line({ flagHours: 8 })]),
        entry("2026-08-02", [line({ isUpsell: true, flagHours: 2 })]),
      ],
      { splitDay: SPLIT },
    );
    expect(points).toHaveLength(2);
    expect(points[0].upsellHours).toBe(0);
    expect(points[0].share).toBe(0);
  });

  it("caps to the most RECENT periods", () => {
    const many = [
      entry("2026-04-02", [line()]),
      entry("2026-05-02", [line()]),
      entry("2026-06-02", [line()]),
      entry("2026-07-02", [line()]),
    ];
    const points = upsellByPeriod(many, { splitDay: SPLIT, limit: 2 });
    expect(points.map((p) => p.key)).toEqual(["2026-06-P1", "2026-07-P1"]);
  });

  it("follows period overrides, like every other per-period figure", () => {
    const points = upsellByPeriod(
      [entry("2026-07-31", [line({ isUpsell: true, flagHours: 1 })])],
      {
        splitDay: 14,
        periodOverrides: {
          "2026-07-P2": { start: "2026-07-15", end: "2026-07-30" },
        },
      },
    );
    // Jul 31 falls past the overridden close, so it belongs to the next period.
    expect(points[0].key).toBe("2026-08-P1");
  });
});

describe("topUpsoldCodes", () => {
  const library: OpCode[] = [
    {
      id: "OC1",
      userId: "U",
      code: "BRK-F",
      description: "Front brakes",
      flagHours: 1.5,
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00Z",
      notes: "",
      tags: [],
      subOpCodes: [],
    },
  ];

  it("ranks by hours sold and counts the uses", () => {
    const codes = topUpsoldCodes(
      [
        entry("2026-08-01", [line({ isUpsell: true, opCodeId: "OC1", flagHours: 1.5 })]),
        entry("2026-08-02", [line({ isUpsell: true, opCodeId: "OC1", flagHours: 1.5 })]),
        entry("2026-08-03", [
          line({ isUpsell: true, custom: true, customCode: "WIPERS", flagHours: 0.3 }),
        ]),
      ],
      library,
    );
    expect(codes[0]).toMatchObject({ code: "BRK-F", hours: 3, count: 2 });
    expect(codes[1]).toMatchObject({ code: "WIPERS", hours: 0.3, count: 1 });
  });

  it("keeps custom lines — the best upsell often isn't in the library yet", () => {
    const codes = topUpsoldCodes(
      [
        entry("2026-08-01", [
          line({
            isUpsell: true,
            custom: true,
            customCode: "CABIN-F",
            customDescription: "Cabin filter",
            flagHours: 0.4,
          }),
        ]),
      ],
      library,
    );
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({
      code: "CABIN-F",
      description: "Cabin filter",
      opCodeId: null,
    });
  });

  it("groups a custom code case-insensitively instead of splitting it", () => {
    const codes = topUpsoldCodes(
      [
        entry("2026-08-01", [
          line({ isUpsell: true, custom: true, customCode: "wipers", flagHours: 0.2 }),
        ]),
        entry("2026-08-02", [
          line({ isUpsell: true, custom: true, customCode: "WIPERS", flagHours: 0.2 }),
        ]),
      ],
      library,
    );
    expect(codes).toHaveLength(1);
    expect(codes[0].count).toBe(2);
  });

  it("skips a line with nothing to name it by", () => {
    // A library line whose op code was deleted, or a custom line saved blank.
    const codes = topUpsoldCodes(
      [
        entry("2026-08-01", [line({ isUpsell: true, opCodeId: "GONE", flagHours: 1 })]),
        entry("2026-08-02", [line({ isUpsell: true, custom: true, customCode: "  " })]),
      ],
      library,
    );
    expect(codes).toEqual([]);
  });

  it("ignores unmarked lines entirely", () => {
    const codes = topUpsoldCodes(
      [entry("2026-08-01", [line({ opCodeId: "OC1", flagHours: 1.5 })])],
      library,
    );
    expect(codes).toEqual([]);
  });
});
