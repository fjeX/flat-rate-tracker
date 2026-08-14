import { describe, it, expect } from "vitest";
import {
  inferCodeDurations,
  MIN_DAYS_TO_SOLVE,
  type Inference,
} from "./time-inference";
import type { DayDenom } from "./stats";
import type { Entry, EntryOpCode, OpCode } from "./types";

const library: OpCode[] = [
  { id: "lof", code: "LOF", description: "Oil change" },
  { id: "tr4", code: "TR4", description: "Rotate" },
  { id: "brk", code: "BRK", description: "Brakes" },
].map(
  (o) =>
    ({
      ...o,
      userId: "u",
      flagHours: 1,
      sortOrder: 0,
      createdAt: "",
      notes: "",
      tags: [],
      subOpCodes: [],
    }) as unknown as OpCode,
);

function day(i: number): string {
  // Spread across months so we never run past a 31-day boundary.
  const m = 1 + Math.floor(i / 28);
  const d = 1 + (i % 28);
  return `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function mkLine(opCodeId: string, i: number): EntryOpCode {
  return {
    id: `${opCodeId}-${i}`,
    opCodeId,
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
  };
}

/**
 * Build a world where each code has a KNOWN true duration and each day has a
 * known overhead, then check the solver recovers them. This is the only honest
 * way to test a regression: assert against ground truth you constructed.
 */
function world(
  n: number,
  counts: (i: number) => Record<string, number>,
  truth: Record<string, number>,
  overhead: number,
): { entries: Entry[]; denom: Record<string, DayDenom> } {
  const entries: Entry[] = [];
  const denom: Record<string, DayDenom> = {};
  for (let i = 0; i < n; i++) {
    const date = day(i);
    const c = counts(i);
    const lines: EntryOpCode[] = [];
    let hours = overhead;
    for (const [code, count] of Object.entries(c)) {
      for (let k = 0; k < count; k++) lines.push(mkLine(code, i * 100 + k));
      hours += count * truth[code];
    }
    entries.push({
      id: `e${i}`,
      userId: "u",
      createdAt: "",
      updatedAt: "",
      date,
      roNumber: `${i}`,
      vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
      opCodes: lines,
      flagHours: lines.length,
      notes: "",
    });
    denom[date] = { hours: Math.round(hours * 100) / 100, source: "clocked" };
  }
  return { entries, denom };
}

function ok(inf: Inference) {
  expect(inf.ok).toBe(true);
  if (!inf.ok) throw new Error("refused");
  return inf;
}

describe("inferCodeDurations — recovering known durations", () => {
  it("solves for job times nobody ever timed", () => {
    // Ground truth: LOF 0.4h, TR4 0.3h, BRK 1.5h, plus 0.8h of daily overhead.
    // Mixes vary independently, which is exactly the condition that makes the
    // system solvable.
    const { entries, denom } = world(
      40,
      // Periods 3, 4 and 5 are coprime, so over 40 days the three counts vary
      // independently — the condition that makes the system solvable at all.
      (i) => ({ lof: 1 + (i % 3), tr4: i % 4, brk: i % 5 }),
      { lof: 0.4, tr4: 0.3, brk: 1.5 },
      0.8,
    );
    const inf = ok(inferCodeDurations(entries, denom, library));

    const by = Object.fromEntries(inf.durations.map((d) => [d.code, d]));
    expect(by.LOF.hours).toBeCloseTo(0.4, 1);
    expect(by.TR4.hours).toBeCloseTo(0.3, 1);
    expect(by.BRK.hours).toBeCloseTo(1.5, 1);
    expect(inf.dailyOverheadHours).toBeCloseTo(0.8, 1);
    expect(inf.rSquared).toBeGreaterThan(0.95);
  });

  it("recovers the overhead that never appears on a ticket", () => {
    // The intercept is the only estimate of shop time the app can produce
    // without anyone logging it.
    const { entries, denom } = world(
      40,
      (i) => ({ lof: 1 + (i % 3), brk: i % 5 }),
      { lof: 0.5, brk: 2 },
      1.75,
    );
    const inf = ok(inferCodeDurations(entries, denom, library));
    expect(inf.dailyOverheadHours).toBeCloseTo(1.75, 1);
  });

  it("refuses when the answer would not describe the tech's days", () => {
    // Day lengths unrelated to the work on them. The model must not dress that
    // up as an explanation — and must not print per-code minutes off it either.
    const entries: Entry[] = [];
    const denom: Record<string, DayDenom> = {};
    for (let i = 0; i < 40; i++) {
      const date = day(i);
      entries.push({
        id: `e${i}`,
        userId: "u",
        createdAt: "",
        updatedAt: "",
        date,
        roNumber: `${i}`,
        vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
        opCodes: [mkLine("lof", i), mkLine("tr4", i)],
        flagHours: 2,
        notes: "",
      });
      denom[date] = { hours: 3 + ((i * 7919) % 60) / 10, source: "clocked" };
    }
    const inf = inferCodeDurations(entries, denom, library);
    expect(inf.ok).toBe(false);
    if (!inf.ok) expect(inf.reason).toBe("poor-fit");
  });
});

describe("inferCodeDurations — refusing rather than guessing", () => {
  it("will not solve without enough days", () => {
    const { entries, denom } = world(
      10,
      () => ({ lof: 1 }),
      { lof: 0.5 },
      1,
    );
    const inf = inferCodeDurations(entries, denom, library);
    expect(inf.ok).toBe(false);
    if (!inf.ok) {
      expect(inf.reason).toBe("not-enough-days");
      if (inf.reason === "not-enough-days") expect(inf.needed).toBe(MIN_DAYS_TO_SOLVE);
    }
  });

  it("ignores a code that barely ever appears", () => {
    const { entries, denom } = world(
      40,
      (i): Record<string, number> =>
        i === 0 ? { lof: 1, brk: 1 } : { lof: 1 + (i % 3) },
      { lof: 0.5, brk: 2 },
      1,
    );
    const inf = ok(inferCodeDurations(entries, denom, library));
    // BRK appeared on one day. One observation cannot support a coefficient.
    expect(inf.durations.some((d) => d.code === "BRK")).toBe(false);
  });

  it("says so when there is nothing to solve for", () => {
    const denom: Record<string, DayDenom> = {};
    // Lengths must vary, or the uniformity guard fires first and we never reach
    // the case under test.
    for (let i = 0; i < 30; i++) {
      denom[day(i)] = { hours: 6 + (i % 5), source: "clocked" };
    }
    const inf = inferCodeDurations([], denom, library);
    expect(inf.ok).toBe(false);
    if (!inf.ok) expect(inf.reason).toBe("not-enough-codes");
  });
});

describe("inferCodeDurations — collinearity, the failure mode that lies", () => {
  it("marks two codes that always ride together as unreliable", () => {
    // Production shape: 10KB and LOF co-occur on 30 of 37 days. Least squares
    // will print two confident numbers whose SPLIT is arbitrary; only their sum
    // is pinned. The page must not present that as solved.
    const { entries, denom } = world(
      40,
      (i) => ({ lof: 1 + (i % 3), tr4: 1 + (i % 3), brk: i % 4 }),
      { lof: 0.4, tr4: 0.3, brk: 1.5 },
      1,
    );
    const inf = ok(inferCodeDurations(entries, denom, library));
    const by = Object.fromEntries(inf.durations.map((d) => [d.code, d]));

    expect(by.LOF.reliable).toBe(false);
    expect(by.TR4.reliable).toBe(false);
    expect(by.LOF.tangledWith).toBe("TR4");
    expect(by.TR4.tangledWith).toBe("LOF");
    // The independently-varying code is still fine.
    expect(by.BRK.reliable).toBe(true);
    expect(by.BRK.hours).toBeCloseTo(1.5, 1);
  });

  it("still gets the tangled pair's COMBINED time about right", () => {
    // What the data genuinely supports: LOF+TR4 together take ~0.7h.
    const { entries, denom } = world(
      40,
      (i) => ({ lof: 1 + (i % 3), tr4: 1 + (i % 3), brk: i % 4 }),
      { lof: 0.4, tr4: 0.3, brk: 1.5 },
      1,
    );
    const inf = ok(inferCodeDurations(entries, denom, library));
    const by = Object.fromEntries(inf.durations.map((d) => [d.code, d]));
    expect(by.LOF.hours + by.TR4.hours).toBeCloseTo(0.7, 1);
  });

  it("never returns a negative duration", () => {
    // A job cannot take negative time, whatever the arithmetic says.
    const { entries, denom } = world(
      40,
      (i) => ({ lof: i % 4, tr4: 3 - (i % 4), brk: i % 3 }),
      { lof: 0.4, tr4: 0.3, brk: 1.2 },
      1,
    );
    const inf = ok(inferCodeDurations(entries, denom, library));
    for (const d of inf.durations) expect(d.hours).toBeGreaterThanOrEqual(0);
  });
});

describe("inferCodeDurations — what it counts", () => {
  it("leaves comebacks out of the job columns", () => {
    // Unpaid rework is not a unit of dispatched work. It still ate clock time,
    // so the intercept is the honest place for it.
    const { entries, denom } = world(
      40,
      (i) => ({ lof: 1 + (i % 3), brk: i % 4 }),
      { lof: 0.5, brk: 1.5 },
      1,
    );
    entries[0].opCodes.push({
      ...mkLine("brk", 999),
      flagHours: 0,
      isComeback: true,
    });
    const inf = ok(inferCodeDurations(entries, denom, library));
    const brk = inf.durations.find((d) => d.code === "BRK")!;
    // One extra comeback line must not shift the solved duration.
    expect(brk.hours).toBeCloseTo(1.5, 1);
  });

  it("only uses days whose length the app knows", () => {
    const { entries, denom } = world(
      40,
      (i) => ({ lof: 1 + (i % 3), brk: i % 4 }),
      { lof: 0.5, brk: 1.5 },
      1,
    );
    // An RO on a day with no denominator contributes an equation with no
    // left-hand side; it must be dropped, not treated as a zero-hour day.
    entries.push({
      ...entries[0],
      id: "orphan",
      date: "2026-11-11",
      opCodes: [mkLine("lof", 5000)],
    });
    const inf = ok(inferCodeDurations(entries, denom, library));
    expect(inf.days).toBe(40);
    expect(inf.durations.find((d) => d.code === "LOF")!.hours).toBeCloseTo(0.5, 1);
  });
});

describe("inferCodeDurations — the assumption that is often false in this trade", () => {
  it("refuses when every clocked day is the same length", () => {
    // A flat-rate tech clocks the same shift whether they turned four jobs or
    // fourteen; they absorb the difference by working faster, not by staying
    // later. The model assumes the opposite. Against one real tech's 39 days
    // (mean 8.15h, nearly all 7.6-9.0) it put 7.41 of 8.15 hours into the
    // intercept and priced an oil change at nine minutes.
    const { entries, denom } = world(
      40,
      (i) => ({ lof: 1 + (i % 3), tr4: i % 4, brk: i % 5 }),
      { lof: 0.4, tr4: 0.3, brk: 1.5 },
      0.8,
    );
    // Flatten every day to the same shift length.
    for (const d of Object.keys(denom)) denom[d] = { hours: 8, source: "clocked" };

    const inf = inferCodeDurations(entries, denom, library);
    expect(inf.ok).toBe(false);
    if (!inf.ok) expect(inf.reason).toBe("days-too-uniform");
  });

  it("still solves when the day genuinely stretches with the work", () => {
    const { entries, denom } = world(
      40,
      (i) => ({ lof: 1 + (i % 3), tr4: i % 4, brk: i % 5 }),
      { lof: 0.4, tr4: 0.3, brk: 1.5 },
      0.8,
    );
    const inf = ok(inferCodeDurations(entries, denom, library));
    expect(inf.rSquared).toBeGreaterThan(0.95);
  });
});

describe("inferCodeDurations — never renders a reason it cannot name", () => {
  it("distinguishes a tangled code from one with no signal", () => {
    // "tangledWith === null" was doing double duty and produced the string
    // "tangled with null" on screen.
    const { entries, denom } = world(
      40,
      (i) => ({ lof: 1 + (i % 3), tr4: 1 + (i % 3), brk: i % 5 }),
      { lof: 0.4, tr4: 0.3, brk: 1.5 },
      1,
    );
    const inf = ok(inferCodeDurations(entries, denom, library));
    for (const d of inf.durations) {
      if (d.reliable) {
        expect(d.unreliableReason).toBeNull();
      } else {
        expect(d.unreliableReason).not.toBeNull();
        // Whenever the reason is "tangled", there is a real partner to name.
        if (d.unreliableReason === "tangled") expect(d.tangledWith).toBeTruthy();
      }
    }
  });
});
