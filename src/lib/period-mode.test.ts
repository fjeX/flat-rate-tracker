import { describe, it, expect } from "vitest";
import { periodMode, projectionLabel } from "./period-mode";
import type { Forecast } from "./forecast";

function forecast(over: Partial<Forecast> = {}): Forecast {
  return {
    state: "ahead",
    current: 42,
    goal: 88,
    avgPerDay: 7,
    daysRemaining: 5,
    projected: 77,
    gap: -11,
    requiredPerDay: 9.2,
    workedWeekdays: [1, 2, 3, 4, 5],
    ...over,
  };
}

describe("periodMode", () => {
  it("is in_progress while the period is still running", () => {
    expect(
      periodMode({ end: "2026-07-31", today: "2026-07-21", paidFlagHours: null }),
    ).toBe("in_progress");
  });

  it("treats the final day as still running (end is inclusive)", () => {
    expect(
      periodMode({ end: "2026-07-15", today: "2026-07-15", paidFlagHours: null }),
    ).toBe("in_progress");
  });

  it("is awaiting_pay the day after the period closes", () => {
    expect(
      periodMode({ end: "2026-07-15", today: "2026-07-16", paidFlagHours: null }),
    ).toBe("awaiting_pay");
  });

  it("is settled once paid hours are recorded", () => {
    expect(
      periodMode({ end: "2026-07-15", today: "2026-07-20", paidFlagHours: 74.2 }),
    ).toBe("settled");
  });

  it("treats a recorded zero as settled, not as missing", () => {
    // 0 is a real answer ("I was paid nothing this period"). Only null means
    // "no stub logged yet" — a truthiness check here would strand the period in
    // awaiting_pay forever.
    expect(
      periodMode({ end: "2026-07-15", today: "2026-07-20", paidFlagHours: 0 }),
    ).toBe("settled");
  });

  it("lets recorded pay win over the calendar for a still-running period", () => {
    expect(
      periodMode({ end: "2026-07-31", today: "2026-07-20", paidFlagHours: 60 }),
    ).toBe("settled");
  });

  it("stays awaiting_pay for an old period that was never reconciled", () => {
    // Deliberate: an unchecked period keeps nudging rather than ageing out.
    expect(
      periodMode({ end: "2025-01-15", today: "2026-07-30", paidFlagHours: null }),
    ).toBe("awaiting_pay");
  });
});

describe("projectionLabel", () => {
  it("reports the projection against the goal", () => {
    expect(projectionLabel(forecast(), 88)).toEqual({
      kind: "projected",
      projected: 77,
      goal: 88,
      state: "ahead",
    });
  });

  it("has nothing to say without a goal", () => {
    expect(projectionLabel(forecast(), 0)).toEqual({ kind: "none" });
  });

  it("says so when there isn't enough history to project", () => {
    expect(
      projectionLabel(
        forecast({ state: "insufficient-history", projected: null }),
        88,
      ),
    ).toEqual({ kind: "no_history" });
  });

  it("suppresses a wildly implausible early extrapolation", () => {
    // Two strong days early in a period can project 486h against an 88h goal.
    // Honest arithmetic, but it reads as a bug — report the state, drop the number.
    expect(projectionLabel(forecast({ projected: 486 }), 88)).toEqual({
      kind: "implausible",
      state: "ahead",
    });
  });

  it("keeps a projection sitting just under the implausible threshold", () => {
    expect(projectionLabel(forecast({ projected: 131 }), 88)).toMatchObject({
      kind: "projected",
      projected: 131,
    });
  });

  it("drops a projection exactly at the threshold", () => {
    expect(projectionLabel(forecast({ projected: 132 }), 88)).toMatchObject({
      kind: "implausible",
    });
  });

  it("treats a null projection as no history even when the state disagrees", () => {
    expect(projectionLabel(forecast({ projected: null }), 88)).toEqual({
      kind: "no_history",
    });
  });
});
