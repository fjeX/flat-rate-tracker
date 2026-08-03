import { describe, it, expect } from "vitest";
import {
  buildSnapshotStats,
  chronological,
  settledThresholds,
  unbackedSnapshots,
} from "./snapshots";
import { snapshotSeqForThreshold } from "./career";
import type { Entry, EntryOpCode, OpCode } from "./types";

let seq = 0;
function line(partial: Partial<EntryOpCode>): EntryOpCode {
  return {
    id: `l${seq++}`,
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
    ...partial,
  };
}

function mk(date: string, lines: EntryOpCode[], createdAt = `${date}T12:00:00Z`): Entry {
  const id = `e${seq++}`;
  return {
    id,
    userId: "u",
    createdAt,
    updatedAt: createdAt,
    date,
    roNumber: `RO${seq}`,
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
    opCodes: lines,
  };
}

const LIB: OpCode[] = [
  {
    id: "brk", code: "BRK-F", description: "Front Brake Pads & Rotors",
    flagHours: 1.5, sortOrder: 0, createdAt: "", notes: "", tags: [], variants: [],
  } as unknown as OpCode,
  {
    id: "lof", code: "LOF", description: "Lube, Oil, Filter",
    flagHours: 0.3, sortOrder: 1, createdAt: "", notes: "", tags: [], variants: [],
  } as unknown as OpCode,
];

describe("chronological", () => {
  it("sorts by date then created_at", () => {
    const a = mk("2026-06-09", [line({})]);
    const b = mk("2026-06-08", [line({})], "2026-06-08T15:00:00Z");
    const c = mk("2026-06-08", [line({})], "2026-06-08T09:00:00Z");
    expect(chronological([a, b, c]).map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe("buildSnapshotStats", () => {
  it("aggregates totals, top ops, photos, and range", () => {
    const entries = [
      mk("2026-06-08", [
        line({ opCodeId: "brk", flagHours: 1.5, actualHours: 1.2 }),
        line({ opCodeId: "lof", flagHours: 0.3, actualHours: 0.3 }),
      ]),
      mk("2026-06-09", [
        line({ opCodeId: "brk", flagHours: 1.5, actualHours: 1.4 }),
      ]),
      mk("2026-06-09", [
        line({ custom: true, customCode: "DIAG", customDescription: "Electrical diag", flagHours: 1.0, actualHours: 1.5 }),
        line({ opCodeId: "brk", flagHours: 1.3, actualHours: 1.0 }),
      ]),
    ];
    const photos = [entries[0].id, entries[0].id, "other-entry"];
    const stats = buildSnapshotStats(entries, LIB, photos);

    expect(stats.roCount).toBe(3);
    expect(stats.totalFlagHours).toBeCloseTo(5.6);
    expect(stats.photoCount).toBe(2);
    expect(stats.workDays).toBe(2);
    expect(stats.firstDate).toBe("2026-06-08");
    expect(stats.lastDate).toBe("2026-06-09");
    expect(stats.topOps[0]).toMatchObject({ code: "BRK-F", count: 3 });
    // 5 lines with actuals: sum(actual)/sum(flag) = 5.4 / 5.6
    expect(stats.avgVsBook).toBeCloseTo(0.96, 2);
  });

  it("hides avg-vs-book when too few lines carry actual hours", () => {
    const entries = [
      mk("2026-06-08", [line({ opCodeId: "brk", flagHours: 1.5, actualHours: 1.2 })]),
      mk("2026-06-09", [line({ opCodeId: "lof", flagHours: 0.3 })]),
    ];
    const stats = buildSnapshotStats(entries, LIB, []);
    expect(stats.avgVsBook).toBeNull();
    expect(stats.photoCount).toBe(0);
  });

  it("hides avg-vs-book when actuals are trivially small (seconds-long timer runs)", () => {
    // 5 lines clear MIN_BOOK_LINES, but 0.02h actuals against 2h flags would
    // produce a meaningless 0.01× — the actual-hours floor keeps it null.
    const entries = [
      mk("2026-06-08", Array.from({ length: 5 }, () =>
        line({ opCodeId: "brk", flagHours: 2, actualHours: 0.02 }),
      )),
    ];
    const stats = buildSnapshotStats(entries, LIB, []);
    expect(stats.avgVsBook).toBeNull();
  });

  it("omits overall efficiency without schedule data", () => {
    const entries = [mk("2026-06-08", [line({ flagHours: 8 })])];
    const stats = buildSnapshotStats(entries, LIB, []);
    expect(stats.overallEfficiency).toBeNull();
    expect(stats.efficiencySource).toBeNull();
  });

  it("freezes schedule-aware overall efficiency over the snapshot range", () => {
    // Mon 06-08 and Tue 06-09, Mon–Fri 8h schedule, no clock rows: 12 flag
    // over 16 scheduled hours = 75%, source "scheduled".
    const SHIFT_8 = { start: "08:00", end: "17:00", breakMin: 60 };
    const entries = [
      mk("2026-06-08", [line({ flagHours: 8 })]),
      mk("2026-06-09", [line({ flagHours: 4 })]),
    ];
    const stats = buildSnapshotStats(entries, LIB, [], {
      clocks: [],
      ctx: {
        schedules: [
          {
            id: "s1",
            effectiveFrom: "2026-06-01",
            rotationWeeks: 1,
            anchorMonday: "2026-06-01",
            weeks: [
              {
                mon: SHIFT_8, tue: SHIFT_8, wed: SHIFT_8, thu: SHIFT_8,
                fri: SHIFT_8, sat: null, sun: null,
              },
            ],
            createdAt: "2026-06-01T00:00:00Z",
          },
        ],
        daysOff: [],
        confirmedZeroDays: [],
        today: "2026-07-15", // generation day — the whole range is completed
      },
    });
    expect(stats.overallEfficiency).toBe(75);
    expect(stats.efficiencySource).toBe("scheduled");
  });
});

describe("snapshotSeqForThreshold", () => {
  it("is the 1-based position in the unlock schedule", () => {
    expect(snapshotSeqForThreshold(10)).toBe(1);
    expect(snapshotSeqForThreshold(100)).toBe(4);
    expect(snapshotSeqForThreshold(200)).toBe(5);
    expect(snapshotSeqForThreshold(700)).toBe(10);
    expect(() => snapshotSeqForThreshold(150)).toThrow();
  });
});

describe("settledThresholds", () => {
  const HOUR = 60 * 60 * 1000;
  const at = (iso: string) => Date.parse(iso);
  // 10 ROs, all logged well in the past.
  const settled = Array.from({ length: 10 }, (_, i) =>
    mk("2026-07-01", [line({ flagHours: 1 })], `2026-07-01T0${i}:00:00Z`),
  );

  it("freezes a threshold whose rows have stopped moving", () => {
    expect(settledThresholds(settled, [10], at("2026-07-02T00:00:00Z"))).toEqual([10]);
  });

  it("holds back a threshold whose last RO is minutes old", () => {
    // The production case: the 10th RO was just created, and may yet be
    // deleted. Freezing now risks a permanent record of a milestone that
    // never happened.
    const fresh = [
      ...settled.slice(0, 9),
      mk("2026-07-01", [line({ flagHours: 1 })], "2026-07-01T23:59:00Z"),
    ];
    expect(settledThresholds(fresh, [10], at("2026-07-02T00:00:00Z"))).toEqual([]);
  });

  it("holds back when a BACKDATED RO lands inside an already-crossed window", () => {
    // Logged today but dated last month, so chronological() sorts it into the
    // first 10 — which changes what "the first 10 ROs" means. Keyed on the
    // newest createdAt in the window, not on the 10th row alone.
    const withBackdated = chronological([
      ...settled.slice(0, 9),
      mk("2026-06-01", [line({ flagHours: 1 })], "2026-07-01T23:59:00Z"),
    ]);
    expect(settledThresholds(withBackdated, [10], at("2026-07-02T00:00:00Z"))).toEqual([]);
  });

  it("never freezes a threshold the tech has not actually reached", () => {
    expect(settledThresholds(settled, [25], at("2030-01-01T00:00:00Z"))).toEqual([]);
  });

  it("settles rather than blocks on an unparseable timestamp", () => {
    const bad = Array.from({ length: 10 }, () =>
      mk("2026-07-01", [line({ flagHours: 1 })], "not-a-date"),
    );
    expect(settledThresholds(bad, [10], at("2026-07-02T00:00:00Z"))).toEqual([10]);
  });

  it("releases the threshold once the settle window has passed", () => {
    const fresh = [
      ...settled.slice(0, 9),
      mk("2026-07-01", [line({ flagHours: 1 })], "2026-07-01T23:00:00Z"),
    ];
    const justBefore = at("2026-07-01T23:59:00Z");
    const justAfter = at("2026-07-02T00:00:00Z") + HOUR;
    expect(settledThresholds(fresh, [10], justBefore)).toEqual([]);
    expect(settledThresholds(fresh, [10], justAfter)).toEqual([10]);
  });
});

describe("unbackedSnapshots", () => {
  const snap = (roThreshold: number) => ({ roThreshold });

  it("withdraws a snapshot claiming more ROs than the tech has", () => {
    // The production case: RO #100 was a disposable test, froze snapshot #4 at
    // 100, then was deleted — leaving the dashboard showing "99/100" beneath a
    // frozen snapshot of 100.
    expect(unbackedSnapshots([snap(10), snap(25), snap(50), snap(100)], 99)).toEqual([
      snap(100),
    ]);
  });

  it("keeps every snapshot a legitimate deletion still clears", () => {
    // A tech at 149 who deletes one RO has NOT lost the 100 milestone. Only
    // thresholds above the current count are contradictions.
    expect(unbackedSnapshots([snap(10), snap(25), snap(50), snap(100)], 148)).toEqual([]);
  });

  it("treats a snapshot exactly at the current count as backed", () => {
    expect(unbackedSnapshots([snap(100)], 100)).toEqual([]);
  });
});
