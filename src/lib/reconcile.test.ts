import { describe, it, expect } from "vitest";
import {
  payStatus,
  reconcileEntries,
  unreconciledLines,
  shortfallDollars,
  PAY_EPS,
  sortUnreconciledLines,
  type UnreconciledLine,
} from "./reconcile";
import { ratesToMap } from "./earnings";
import type { Entry, EntryOpCode, LaborType } from "./types";

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
    id: "e",
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date: "2026-07-01",
    roNumber: "1",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
    ...over,
  };
}

const rateOf = (type: LaborType, hourlyRate: number) => ({ laborType: type, hourlyRate });

describe("payStatus", () => {
  it("null paid → pending", () => {
    expect(payStatus(1.0, null)).toBe("pending");
  });

  it("exact match → paid", () => {
    expect(payStatus(2.0, 2.0)).toBe("paid");
  });

  it("within tolerance → paid (flag 1.0, paid 0.95)", () => {
    expect(payStatus(1.0, 0.95)).toBe("paid");
  });

  it("just past tolerance → short (flag 1.0, paid 0.94)", () => {
    expect(payStatus(1.0, 0.94)).toBe("short");
  });

  it("over tolerance on the high side → over", () => {
    expect(payStatus(1.0, 1.5)).toBe("over");
  });

  it("high-side boundary within eps stays paid", () => {
    expect(payStatus(1.0, 1.0 + PAY_EPS)).toBe("paid");
    expect(payStatus(1.0, 1.0 + PAY_EPS + 0.01)).toBe("over");
  });

  it("zero paid but nonzero flag → short (not pending)", () => {
    expect(payStatus(2.0, 0)).toBe("short");
  });
});

describe("reconcileEntries", () => {
  it("aggregates a mix of pending/paid/short/over lines", () => {
    const entries = [
      entry([
        line({ id: "a", flagHours: 2, paidHours: null }), // pending
        line({ id: "b", flagHours: 2, paidHours: 2 }), // paid
      ]),
      entry([
        line({ id: "c", flagHours: 3, paidHours: 1.5 }), // short by 1.5
        line({ id: "d", flagHours: 1, paidHours: 2 }), // over
      ]),
    ];
    const s = reconcileEntries(entries);
    expect(s.totalFlagged).toBe(8);
    // paid lines: 2 (b) + 1.5 (c) + 2 (d); pending (a) excluded
    expect(s.totalPaid).toBeCloseTo(5.5, 5);
    expect(s.shortedHours).toBeCloseTo(1.5, 5);
    expect(s.pendingCount).toBe(1);
    expect(s.shortLineCount).toBe(1);
    expect(s.overCount).toBe(1);
  });

  it("empty entries → all zeros", () => {
    const s = reconcileEntries([]);
    expect(s).toEqual({
      totalFlagged: 0,
      totalPaid: 0,
      shortedHours: 0,
      pendingCount: 0,
      shortLineCount: 0,
      overCount: 0,
    });
  });
});

describe("unreconciledLines", () => {
  it("returns only pending and short lines, dropping paid and over", () => {
    const entries = [
      entry([
        line({ id: "a", flagHours: 2, paidHours: null }), // pending
        line({ id: "b", flagHours: 2, paidHours: 2 }), // paid → dropped
        line({ id: "c", flagHours: 3, paidHours: 1 }), // short
        line({ id: "d", flagHours: 1, paidHours: 3 }), // over → dropped
      ]),
    ];
    const rows = unreconciledLines(entries);
    expect(rows.map((r) => r.line.id)).toEqual(["a", "c"]);
    expect(rows.map((r) => r.status)).toEqual(["pending", "short"]);
  });
});

describe("shortfallDollars", () => {
  it("returns null when no rates are priced", () => {
    const entries = [entry([line({ flagHours: 2, paidHours: 0 })])];
    expect(shortfallDollars(entries, {})).toBeNull();
  });

  it("prices each shorted line by its own labor-type rate", () => {
    const rates = ratesToMap([
      rateOf("customer_pay", 30),
      rateOf("warranty", 20),
    ]);
    const entries = [
      entry([
        // untyped → customer_pay rate; short by 1h → $30
        line({ id: "a", flagHours: 2, paidHours: 1, laborType: null }),
        // warranty short by 2h → $40
        line({ id: "b", flagHours: 3, paidHours: 1, laborType: "warranty" }),
        // paid in full → contributes nothing
        line({ id: "c", flagHours: 1, paidHours: 1, laborType: "customer_pay" }),
      ]),
    ];
    expect(shortfallDollars(entries, rates)).toBeCloseTo(70, 5);
  });

  it("shorted line of an unpriced type contributes 0 but still returns a number", () => {
    const rates = ratesToMap([rateOf("warranty", 20)]); // customer_pay unpriced
    const entries = [
      entry([line({ flagHours: 2, paidHours: 0, laborType: "customer_pay" })]),
    ];
    // hasAnyRate is true (warranty priced), but this line's type is unpriced → 0
    expect(shortfallDollars(entries, rates)).toBe(0);
  });
});

describe("sortUnreconciledLines", () => {
  // Shops hand out a printed sheet in RO-number order; the list has to be
  // readable alongside it.
  function row(
    roNumber: string,
    date: string,
    flag: number,
    paid: number | null = null,
    position = 0,
  ): UnreconciledLine {
    const l = line({
      id: `${roNumber}-${position}`,
      flagHours: flag,
      paidHours: paid,
      position,
    });
    const e = entry([l], { id: `${roNumber}-${date}`, roNumber, date });
    return { entry: e, line: l, status: paid === null ? "pending" : "short" };
  }

  it("orders by RO number ascending by default", () => {
    const rows = [row("99231", "2026-07-20", 2), row("99044", "2026-07-18", 3)];
    expect(sortUnreconciledLines(rows).map((r) => r.entry.roNumber)).toEqual([
      "99044",
      "99231",
    ]);
  });

  it("sorts RO numbers numerically, not as strings", () => {
    // "9910" < "993" as a string, but 993 comes first on the shop's sheet.
    const rows = [row("9910", "2026-07-20", 2), row("993", "2026-07-18", 3)];
    expect(sortUnreconciledLines(rows, "ro").map((r) => r.entry.roNumber)).toEqual(
      ["993", "9910"],
    );
  });

  it("keeps recycled RO numbers together, ordered by date", () => {
    // This shop reuses 5-digit RO numbers, so the same number can appear twice
    // in one period as genuinely different jobs.
    const rows = [
      row("99231", "2026-07-24", 2),
      row("99231", "2026-07-19", 3),
    ];
    expect(sortUnreconciledLines(rows, "ro").map((r) => r.entry.date)).toEqual([
      "2026-07-19",
      "2026-07-24",
    ]);
  });

  it("orders multiple lines on one RO by their position", () => {
    const rows = [
      row("99231", "2026-07-20", 2, null, 2),
      row("99231", "2026-07-20", 3, null, 0),
    ];
    expect(sortUnreconciledLines(rows, "ro").map((r) => r.line.position)).toEqual(
      [0, 2],
    );
  });

  it("sorts unparseable RO numbers last rather than first", () => {
    const rows = [row("SUBLET", "2026-07-20", 2), row("99044", "2026-07-18", 3)];
    expect(sortUnreconciledLines(rows, "ro").map((r) => r.entry.roNumber)).toEqual(
      ["99044", "SUBLET"],
    );
  });

  it("sorts by date newest first", () => {
    const rows = [row("99044", "2026-07-18", 3), row("99231", "2026-07-24", 2)];
    expect(sortUnreconciledLines(rows, "date").map((r) => r.entry.date)).toEqual([
      "2026-07-24",
      "2026-07-18",
    ]);
  });

  it("sorts by biggest shortfall first, with pending lines below", () => {
    const rows = [
      row("99001", "2026-07-18", 3, 2.5), // 0.5h short
      row("99002", "2026-07-19", 5, null), // pending — unknown
      row("99003", "2026-07-20", 4, 1), // 3h short
    ];
    expect(
      sortUnreconciledLines(rows, "shortfall").map((r) => r.entry.roNumber),
    ).toEqual(["99003", "99001", "99002"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row("99231", "2026-07-20", 2), row("99044", "2026-07-18", 3)];
    const before = rows.map((r) => r.entry.roNumber);
    sortUnreconciledLines(rows, "ro");
    expect(rows.map((r) => r.entry.roNumber)).toEqual(before);
  });
});
