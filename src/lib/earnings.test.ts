import { describe, it, expect } from "vitest";
import {
  ratesToMap,
  hasAnyRate,
  resolveLineRate,
  lineEarnings,
  entryEarnings,
  periodEarnings,
  earningsByLaborType,
  warrantyLoss,
  fmtMoney,
  fmtMoney2,
} from "./earnings";
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

describe("ratesToMap / hasAnyRate", () => {
  it("flattens rows and drops non-positive rates", () => {
    const map = ratesToMap([
      rateOf("customer_pay", 32),
      rateOf("warranty", 0), // 0 = unset, dropped
      rateOf("internal", -5), // negative = garbage, dropped
    ]);
    expect(map.customer_pay).toBe(32);
    expect(map.warranty).toBeUndefined();
    expect(map.internal).toBeUndefined();
  });

  it("hasAnyRate is false for an empty map and true once one is priced", () => {
    expect(hasAnyRate({})).toBe(false);
    expect(hasAnyRate(ratesToMap([rateOf("warranty", 20)]))).toBe(true);
  });
});

describe("resolveLineRate / lineEarnings", () => {
  const rates = ratesToMap([rateOf("customer_pay", 30), rateOf("warranty", 18)]);

  it("uses the line's own labor type", () => {
    expect(resolveLineRate(line({ laborType: "warranty" }), rates)).toBe(18);
    expect(lineEarnings(line({ laborType: "warranty", flagHours: 2 }), rates)).toBe(36);
  });

  it("falls back to customer_pay for an untyped (null) line", () => {
    expect(resolveLineRate(line({ laborType: null }), rates)).toBe(30);
    expect(lineEarnings(line({ laborType: null, flagHours: 1.5 }), rates)).toBe(45);
  });

  it("is always unpriced for an explicitly untyped line — no customer_pay fallback", () => {
    expect(resolveLineRate(line({ laborType: "untyped" }), rates)).toBeNull();
    expect(lineEarnings(line({ laborType: "untyped", flagHours: 2 }), rates)).toBeNull();
  });

  it("returns null when the applicable rate is unpriced", () => {
    expect(resolveLineRate(line({ laborType: "internal" }), rates)).toBeNull();
    expect(lineEarnings(line({ laborType: "internal", flagHours: 3 }), rates)).toBeNull();
  });

  it("returns null for everything when no rates are set (graceful degradation)", () => {
    expect(lineEarnings(line({ laborType: "customer_pay", flagHours: 5 }), {})).toBeNull();
    expect(lineEarnings(line({ laborType: null, flagHours: 5 }), {})).toBeNull();
  });
});

describe("entryEarnings / periodEarnings", () => {
  const rates = ratesToMap([rateOf("customer_pay", 30), rateOf("warranty", 20)]);

  it("sums priced lines and treats unpriced lines as 0 in a mixed RO", () => {
    const e = entry([
      line({ id: "a", laborType: "customer_pay", flagHours: 2 }), // 60
      line({ id: "b", laborType: "warranty", flagHours: 1 }), // 20
      line({ id: "c", laborType: "internal", flagHours: 4 }), // unpriced -> 0
    ]);
    expect(entryEarnings(e, rates)).toBe(80);
  });

  it("a fully-unpriced RO earns 0, never NaN", () => {
    const e = entry([line({ laborType: "other", flagHours: 3 })]);
    expect(entryEarnings(e, rates)).toBe(0);
  });

  it("periodEarnings sums across entries", () => {
    const e1 = entry([line({ laborType: null, flagHours: 2 })]); // 60
    const e2 = entry([line({ laborType: "warranty", flagHours: 3 })]); // 60
    expect(periodEarnings([e1, e2], rates)).toBe(120);
    expect(periodEarnings([], rates)).toBe(0);
  });
});

describe("earningsByLaborType", () => {
  const rates = ratesToMap([rateOf("customer_pay", 30), rateOf("warranty", 20)]);

  it("groups hours + dollars, folds untyped into customer_pay, flags unpriced", () => {
    const e = entry([
      line({ id: "a", laborType: "customer_pay", flagHours: 1 }),
      line({ id: "b", laborType: null, flagHours: 1 }), // -> customer_pay bucket
      line({ id: "c", laborType: "warranty", flagHours: 2 }),
      line({ id: "d", laborType: "internal", flagHours: 5 }), // unpriced
      line({ id: "e", laborType: "untyped", flagHours: 9 }), // explicit — excluded entirely
    ]);
    const breakdown = earningsByLaborType([e], rates);
    const cp = breakdown.find((b) => b.laborType === "customer_pay")!;
    const war = breakdown.find((b) => b.laborType === "warranty")!;
    const internal = breakdown.find((b) => b.laborType === "internal")!;

    expect(cp.flagHours).toBe(2);
    expect(cp.earnings).toBe(60);
    expect(war.earnings).toBe(40);
    expect(internal.priced).toBe(false);
    expect(internal.earnings).toBe(0);
    // used_car has no hours, so it's excluded entirely.
    expect(breakdown.some((b) => b.laborType === "used_car")).toBe(false);
  });
});

describe("warrantyLoss", () => {
  it("is null unless BOTH customer_pay and warranty are priced", () => {
    const e = entry([line({ laborType: "warranty", flagHours: 10 })]);
    expect(warrantyLoss([e], ratesToMap([rateOf("customer_pay", 30)]))).toBeNull();
    expect(warrantyLoss([e], ratesToMap([rateOf("warranty", 20)]))).toBeNull();
    expect(warrantyLoss([e], {})).toBeNull();
  });

  it("computes (cp - warranty) * warranty hours", () => {
    const rates = ratesToMap([rateOf("customer_pay", 30), rateOf("warranty", 18)]);
    const e = entry([
      line({ id: "a", laborType: "warranty", flagHours: 10 }),
      line({ id: "b", laborType: "customer_pay", flagHours: 5 }), // not counted
      line({ id: "c", laborType: null, flagHours: 5 }), // untyped != warranty, not counted
    ]);
    expect(warrantyLoss([e], rates)).toBe(120); // (30-18) * 10
  });

  it("is 0 when warranty pays as much or more than customer pay", () => {
    const rates = ratesToMap([rateOf("customer_pay", 20), rateOf("warranty", 25)]);
    const e = entry([line({ laborType: "warranty", flagHours: 8 })]);
    expect(warrantyLoss([e], rates)).toBe(0);
  });
});

describe("fmtMoney", () => {
  it("formats whole dollars with a $ and no cents", () => {
    expect(fmtMoney(412)).toBe("$412");
    expect(fmtMoney(1234)).toBe("$1,234");
    expect(fmtMoney(0)).toBe("$0");
  });

  // Escalation shortfall-one-decimal-float (2026-09-06). periodEarnings is an
  // unrounded reduce over rate x hours, so a true $3,455.50 arrives as
  // 3455.4999999999995 and used to print "$3,455" — a dollar short, downward,
  // with nothing on screen to suggest it. Snapping to cents first fixes it
  // WITHOUT changing the whole-dollar rule, which is intentional here.
  it("rounds float dust up to the dollar it really is", () => {
    expect(3455.4999999999995).not.toBe(3455.5); // the dust is real
    expect(fmtMoney(3455.4999999999995)).toBe("$3,456");
    expect(fmtMoney(3455.5)).toBe("$3,456");
  });

  it("still drops cents, because cents are noise on a period total", () => {
    expect(fmtMoney(412.49)).toBe("$412");
    expect(fmtMoney(412.51)).toBe("$413");
  });
});

// The 2dp twin, re-exported from lib/format so callers here get it too.
describe("fmtMoney2 re-export", () => {
  it("is the audit-surface formatter, not fmtMoney", () => {
    expect(fmtMoney2(44.8)).toBe("$44.80");
    expect(fmtMoney(44.8)).toBe("$45");
  });
});
