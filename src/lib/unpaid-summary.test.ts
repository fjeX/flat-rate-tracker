import { describe, expect, it } from "vitest";
import { buildUnpaidSummary } from "./unpaid-summary";
import type { Entry, EntryOpCode, OpCode, UnpaidTime } from "./types";

function line(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: "l1",
    opCodeId: null,
    custom: true,
    customCode: "CUSTOM",
    customDescription: "Custom work",
    flagHours: 1,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours: null,
    isComeback: false,
    ...over,
  };
}

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    userId: "u1",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    date: "2026-07-01",
    roNumber: "1001",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: [line()],
    flagHours: 1,
    notes: "",
    comebackOfEntryId: null,
    comebackKind: null,
    ...over,
  };
}

function ledger(over: Partial<UnpaidTime> = {}): UnpaidTime {
  return {
    id: "u1",
    userId: "u1",
    date: "2026-07-02",
    hours: 2,
    kind: "wait_parts",
    entryId: null,
    originalEntryId: null,
    source: "manual",
    note: "",
    createdAt: "2026-07-02T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
    ...over,
  };
}

describe("buildUnpaidSummary", () => {
  it("reports zeros and no lines when there is nothing unpaid", () => {
    const s = buildUnpaidSummary({ entries: [entry()] });
    expect(s.lines).toEqual([]);
    expect(s.totalHours).toBe(0);
    expect(s.comebackHours).toBe(0);
    expect(s.totalDollars).toBeNull();
  });

  it("counts a comeback line by ACTUAL hours, not flag hours", () => {
    // A comeback line flags zero by construction (DB CHECK). Summing flag would
    // report the rework as costing nothing.
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: 2.5 })],
        }),
      ],
    });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].source).toBe("ro");
    expect(s.lines[0].hours).toBe(2.5);
    expect(s.comebackHours).toBe(2.5);
    expect(s.totalHours).toBe(2.5);
  });

  it("ignores non-comeback lines on the same RO", () => {
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [
            line({ id: "a", isComeback: false, flagHours: 1.8, actualHours: 2 }),
            line({ id: "b", isComeback: true, flagHours: 0, actualHours: 1.5 }),
          ],
        }),
      ],
    });
    expect(s.lines).toHaveLength(1);
    expect(s.totalHours).toBe(1.5);
  });

  it("buckets ledger rows into comeback, waiting, and shop time", () => {
    const s = buildUnpaidSummary({
      entries: [],
      unpaid: [
        ledger({ id: "a", kind: "comeback_other", hours: 1 }),
        ledger({ id: "b", kind: "rework_same_visit", hours: 0.5 }),
        ledger({ id: "c", kind: "wait_parts", hours: 2 }),
        ledger({ id: "d", kind: "wait_approval", hours: 1 }),
        ledger({ id: "e", kind: "shop_time", hours: 3 }),
      ],
    });
    expect(s.comebackHours).toBe(1.5);
    expect(s.waitingHours).toBe(3);
    expect(s.shopHours).toBe(3);
    expect(s.totalHours).toBe(7.5);
  });

  it("adds RO-side and ledger comebacks without double counting", () => {
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: 2 })],
        }),
      ],
      unpaid: [ledger({ kind: "comeback_other", hours: 1 })],
    });
    expect(s.comebackHours).toBe(3);
    expect(s.byKind.comeback_own).toBe(2);
    expect(s.byKind.comeback_other).toBe(1);
  });

  it("prices an RO comeback line at its own applicable rate", () => {
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [
            line({
              isComeback: true,
              flagHours: 0,
              actualHours: 2,
              laborType: "warranty",
            }),
          ],
        }),
      ],
      rates: { customer_pay: 30, warranty: 20 },
    });
    expect(s.lines[0].dollars).toBe(40);
    expect(s.totalDollars).toBe(40);
    expect(s.unpricedHours).toBe(0);
  });

  it("never invents a rate for a ledger row, and says how many hours that is", () => {
    // A ledger row has no labor type to resolve a rate from. Valuing it at a
    // default would be inventing a figure the tech never entered.
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: 1 })],
        }),
      ],
      unpaid: [ledger({ kind: "wait_parts", hours: 4 })],
      rates: { customer_pay: 30 },
    });
    expect(s.lines.find((l) => l.source === "ledger")?.dollars).toBeNull();
    expect(s.totalDollars).toBe(30); // the RO line only
    expect(s.unpricedHours).toBe(4);
  });

  it("degrades to hours-only when no rate is priced at all", () => {
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: 2 })],
        }),
      ],
      rates: {},
    });
    expect(s.hasRates).toBe(false);
    expect(s.totalDollars).toBeNull();
    expect(s.lines[0].dollars).toBeNull();
    expect(s.totalHours).toBe(2);
  });

  it("leaves an explicitly untyped comeback line unpriced", () => {
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [
            line({
              isComeback: true,
              flagHours: 0,
              actualHours: 2,
              laborType: "untyped",
            }),
          ],
        }),
      ],
      rates: { customer_pay: 30 },
    });
    expect(s.lines[0].dollars).toBeNull();
    expect(s.totalDollars).toBe(0);
    expect(s.unpricedHours).toBe(2);
  });

  it("filters both sources to the range when one is given", () => {
    const s = buildUnpaidSummary({
      entries: [
        entry({
          id: "in",
          date: "2026-07-05",
          comebackKind: "comeback_own",
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: 1 })],
        }),
        entry({
          id: "out",
          date: "2026-06-30",
          comebackKind: "comeback_own",
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: 9 })],
        }),
      ],
      unpaid: [
        ledger({ id: "in2", date: "2026-07-06", hours: 2 }),
        ledger({ id: "out2", date: "2026-08-01", hours: 8 }),
      ],
      range: { start: "2026-07-01", end: "2026-07-31" },
    });
    expect(s.totalHours).toBe(3);
    expect(s.lines).toHaveLength(2);
  });

  it("treats a comeback line with no kind recorded as the tech's own work", () => {
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: null,
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: 1 })],
        }),
      ],
    });
    expect(s.lines[0].kind).toBe("comeback_own");
    expect(s.comebackHours).toBe(1);
  });

  it("keeps a comeback line with no actual hours recorded, at zero", () => {
    // The rework happened; only its duration is missing. Dropping the row would
    // erase the fact that the RO had unpaid work on it.
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: null })],
        }),
      ],
    });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].hours).toBe(0);
    expect(s.totalHours).toBe(0);
  });

  it("resolves the RO number for a ledger row linked to an entry", () => {
    const s = buildUnpaidSummary({
      entries: [entry({ id: "e9", roNumber: "5150" })],
      unpaid: [ledger({ entryId: "e9", kind: "wait_parts", hours: 1 })],
    });
    expect(s.lines[0].roNumber).toBe("5150");
  });

  it("labels an RO comeback line from the library, sub-op included", () => {
    const library: OpCode[] = [
      {
        id: "oc1",
        userId: "u1",
        code: "BRK-FR",
        description: "Front brakes",
        flagHours: 1.8,
        notes: "",
        tags: [],
        sortOrder: 0,
        createdAt: "",
        subOpCodes: [
          {
            id: "s1",
            opCodeId: "oc1",
            userId: "u1",
            code: "PADS",
            description: "Pads only",
            flagHours: 1.2,
            sortOrder: 0,
            createdAt: "",
          },
        ],
      },
    ];
    const s = buildUnpaidSummary({
      entries: [
        entry({
          comebackKind: "comeback_own",
          opCodes: [
            line({
              custom: false,
              customCode: null,
              customDescription: null,
              opCodeId: "oc1",
              subOpCodeId: "s1",
              isComeback: true,
              flagHours: 0,
              actualHours: 1,
            }),
          ],
        }),
      ],
      library,
    });
    expect(s.lines[0].code).toBe("BRK-FR · PADS");
    expect(s.lines[0].description).toBe("Pads only");
  });

  it("sorts lines newest first", () => {
    const s = buildUnpaidSummary({
      entries: [
        entry({
          id: "old",
          date: "2026-07-01",
          comebackKind: "comeback_own",
          opCodes: [line({ isComeback: true, flagHours: 0, actualHours: 1 })],
        }),
      ],
      unpaid: [ledger({ date: "2026-07-09", hours: 1 })],
    });
    expect(s.lines.map((l) => l.date)).toEqual(["2026-07-09", "2026-07-01"]);
  });
});
