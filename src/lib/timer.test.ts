import { describe, it, expect } from "vitest";
import {
  anyAccruing,
  autoStopCap,
  AUTO_STOP_GRACE_MIN,
  bucketFor,
  elapsedFor,
  flushAccumulators,
  formatDuration,
  formatElapsed,
  HOLD_KIND,
  isAccruing,
  isHold,
  localMinutesOfDay,
  MAX_SEGMENT_MS,
  MAX_TIMER_SLOTS,
  minutesFromHHMM,
  msToHours,
  nextFreeSlot,
  STATUS_LABEL,
  STATUS_TONE,
  TIMER_STATUSES,
  unpaidKindFor,
  wasAutoStopped,
  workingSlot,
  type TimerSlot,
} from "./timer";

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000; // fixed epoch — no Date.now() in tests

function slot(over: Partial<TimerSlot> = {}): TimerSlot {
  return {
    id: over.id ?? "t1",
    slot: over.slot ?? 1,
    entryId: over.entryId ?? null,
    lineId: over.lineId ?? null,
    status: over.status ?? "working",
    startTime: over.startTime !== undefined ? over.startTime : T0,
    workAccumulated: over.workAccumulated ?? 0,
    holdPartsAccumulated: over.holdPartsAccumulated ?? 0,
    holdApprovalAccumulated: over.holdApprovalAccumulated ?? 0,
  };
}

describe("bucketFor", () => {
  it("routes each status to its own accumulator", () => {
    expect(bucketFor("working")).toBe("work");
    expect(bucketFor("hold_parts")).toBe("holdParts");
    expect(bucketFor("hold_approval")).toBe("holdApproval");
    expect(bucketFor("paused")).toBe(null);
  });

  it("keeps the two hold reasons distinct", () => {
    expect(bucketFor("hold_parts")).not.toBe(bucketFor("hold_approval"));
    expect(isHold("hold_parts")).toBe(true);
    expect(isHold("hold_approval")).toBe(true);
    expect(isHold("working")).toBe(false);
    expect(isHold("paused")).toBe(false);
  });
});

describe("elapsedFor", () => {
  it("adds the in-flight segment to the work bucket while working", () => {
    const e = elapsedFor(slot({ workAccumulated: HOUR }), T0 + HOUR);
    expect(e.work).toBe(2 * HOUR);
    expect(e.hold).toBe(0);
    expect(e.total).toBe(2 * HOUR);
  });

  it("adds the in-flight segment to the matching hold bucket", () => {
    const e = elapsedFor(
      slot({ status: "hold_parts", workAccumulated: 2 * HOUR }),
      T0 + 3 * HOUR,
    );
    expect(e.work).toBe(2 * HOUR);
    expect(e.holdParts).toBe(3 * HOUR);
    expect(e.holdApproval).toBe(0);
    expect(e.hold).toBe(3 * HOUR);
    expect(e.total).toBe(5 * HOUR);
  });

  it("sums both hold reasons into `hold` without conflating them", () => {
    const e = elapsedFor(
      slot({
        status: "hold_approval",
        workAccumulated: HOUR,
        holdPartsAccumulated: 3 * HOUR,
      }),
      T0 + HOUR,
    );
    expect(e.holdParts).toBe(3 * HOUR);
    expect(e.holdApproval).toBe(HOUR);
    expect(e.hold).toBe(4 * HOUR);
    expect(e.total).toBe(5 * HOUR);
  });

  it("banks nothing while paused, even with a live startTime", () => {
    const e = elapsedFor(
      slot({
        status: "paused",
        workAccumulated: HOUR,
        holdPartsAccumulated: HOUR,
      }),
      T0 + 5 * HOUR,
    );
    expect(e.work).toBe(HOUR);
    expect(e.holdParts).toBe(HOUR);
  });

  it("banks nothing when the clock is stopped", () => {
    const e = elapsedFor(
      slot({ startTime: null, workAccumulated: HOUR }),
      T0 + 5 * HOUR,
    );
    expect(e.work).toBe(HOUR);
  });

  it("never returns negative time when the clock runs backwards", () => {
    const e = elapsedFor(slot(), T0 - 5 * HOUR);
    expect(e.work).toBe(0);
    expect(e.total).toBe(0);
  });

  // Hydration guard. A null `now` means the client hasn't mounted yet, so the
  // server and the first client render must agree — that requires excluding the
  // in-flight segment (whose length depends on a wall clock neither shares)
  // while still counting banked time. Rendering the in-flight segment from a
  // render-time Date.now() is what caused React #418 twice: on the pip
  // (2026-08-02) and on /timer's own cards (timer-page-hydration-418).
  it("excludes the in-flight segment when the wall clock is unknown", () => {
    const e = elapsedFor(slot({ workAccumulated: HOUR }), null);
    expect(e.work).toBe(HOUR);
    expect(e.total).toBe(HOUR);
  });

  it("still banks hold accumulators when the wall clock is unknown", () => {
    const e = elapsedFor(
      slot({
        status: "hold_parts",
        workAccumulated: 2 * HOUR,
        holdPartsAccumulated: HOUR,
      }),
      null,
    );
    expect(e.work).toBe(2 * HOUR);
    expect(e.holdParts).toBe(HOUR);
    expect(e.total).toBe(3 * HOUR);
  });

  it("clamps the in-flight segment at capAt", () => {
    const e = elapsedFor(slot(), T0 + 10 * HOUR, T0 + 2 * HOUR);
    expect(e.work).toBe(2 * HOUR);
  });

  it("leaves already-banked time alone when the cap is in the past", () => {
    const e = elapsedFor(
      slot({ workAccumulated: 3 * HOUR }),
      T0 + 10 * HOUR,
      T0 - HOUR,
    );
    expect(e.work).toBe(3 * HOUR);
  });
});

describe("flushAccumulators", () => {
  it("moves in-flight work time into workAccumulated", () => {
    const f = flushAccumulators(slot({ workAccumulated: HOUR }), T0 + HOUR);
    expect(f).toEqual({
      workAccumulated: 2 * HOUR,
      holdPartsAccumulated: 0,
      holdApprovalAccumulated: 0,
    });
  });

  it("keeps every bucket separate across a full day of status changes", () => {
    // The case the split accumulators exist for: worked 2h, waited on parts 3h,
    // then waited on an approval 1h. A single hold bucket would report all 4
    // waiting hours under whichever reason was active last.
    let s = slot();
    let acc = flushAccumulators(s, T0 + 2 * HOUR);

    s = slot({ status: "hold_parts", startTime: T0 + 2 * HOUR, ...acc });
    acc = flushAccumulators(s, T0 + 5 * HOUR);

    s = slot({ status: "hold_approval", startTime: T0 + 5 * HOUR, ...acc });
    acc = flushAccumulators(s, T0 + 6 * HOUR);

    expect(acc.workAccumulated).toBe(2 * HOUR);
    expect(acc.holdPartsAccumulated).toBe(3 * HOUR);
    expect(acc.holdApprovalAccumulated).toBe(HOUR);
  });

  it("is idempotent once the clock is stopped", () => {
    const stopped = slot({ startTime: null, workAccumulated: HOUR });
    expect(flushAccumulators(stopped, T0 + 9 * HOUR)).toEqual(
      flushAccumulators(stopped, T0 + 99 * HOUR),
    );
  });
});

describe("msToHours", () => {
  it("rounds to hundredths for numeric(5,2)", () => {
    expect(msToHours(HOUR)).toBe(1);
    expect(msToHours(1.5 * HOUR)).toBe(1.5);
    expect(msToHours(HOUR / 3)).toBe(0.33);
    expect(msToHours(0)).toBe(0);
  });

  it("floors negatives at zero rather than emitting a negative", () => {
    expect(msToHours(-HOUR)).toBe(0);
  });
});

describe("formatting", () => {
  it("pads elapsed to HH:MM:SS", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(61_000)).toBe("00:01:01");
  });

  it("does not roll elapsed over past 24 hours", () => {
    expect(formatElapsed(26 * HOUR + 14 * 60_000 + 3_000)).toBe("26:14:03");
  });

  it("writes compact durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(2 * HOUR)).toBe("2h");
    expect(formatDuration(2 * HOUR + 15 * 60_000)).toBe("2h 15m");
  });
});

describe("slot bookkeeping", () => {
  it("finds the lowest free slot and caps at MAX_TIMER_SLOTS", () => {
    expect(nextFreeSlot([])).toBe(1);
    expect(nextFreeSlot([slot({ slot: 1 }), slot({ slot: 3 })])).toBe(2);
    const full = [1, 2, 3].map((n) => slot({ slot: n }));
    expect(full).toHaveLength(MAX_TIMER_SLOTS);
    expect(nextFreeSlot(full)).toBe(null);
  });

  it("identifies the single working slot", () => {
    const slots = [
      slot({ slot: 1, status: "hold_parts" }),
      slot({ slot: 2, status: "working" }),
    ];
    expect(workingSlot(slots)?.slot).toBe(2);
    expect(workingSlot([slot({ status: "paused" })])).toBe(null);
  });

  it("reports accrual for the nav dot — holds count, paused does not", () => {
    expect(isAccruing(slot({ status: "hold_approval" }))).toBe(true);
    expect(isAccruing(slot({ status: "paused" }))).toBe(false);
    expect(isAccruing(slot({ startTime: null }))).toBe(false);
    expect(anyAccruing([slot({ status: "paused" }), slot({ slot: 2 })])).toBe(true);
    expect(anyAccruing([slot({ status: "paused" })])).toBe(false);
  });
});

describe("ledger mapping", () => {
  it("maps hold statuses to ledger kinds and nothing else", () => {
    expect(unpaidKindFor("hold_parts")).toBe("wait_parts");
    expect(unpaidKindFor("hold_approval")).toBe("wait_approval");
    expect(unpaidKindFor("working")).toBe(null);
    expect(unpaidKindFor("paused")).toBe(null);
  });

  it("maps each hold accumulator to a distinct ledger kind", () => {
    expect(HOLD_KIND.holdParts).toBe("wait_parts");
    expect(HOLD_KIND.holdApproval).toBe("wait_approval");
    expect(HOLD_KIND.holdParts).not.toBe(HOLD_KIND.holdApproval);
  });
});

describe("minutesFromHHMM", () => {
  it("parses valid times", () => {
    expect(minutesFromHHMM("00:00")).toBe(0);
    expect(minutesFromHHMM("17:30")).toBe(1050);
    expect(minutesFromHHMM("8:05")).toBe(485);
  });

  it("rejects junk", () => {
    expect(minutesFromHHMM("")).toBe(null);
    expect(minutesFromHHMM(null)).toBe(null);
    expect(minutesFromHHMM("25:00")).toBe(null);
    expect(minutesFromHHMM("12:99")).toBe(null);
    expect(minutesFromHHMM("noon")).toBe(null);
  });
});

describe("localMinutesOfDay", () => {
  it("reads wall-clock minutes in a named zone", () => {
    // 2023-11-14T22:13:20Z → 14:13 in Los Angeles (UTC-8 in November).
    expect(localMinutesOfDay(T0, "America/Los_Angeles")).toBe(14 * 60 + 13);
    expect(localMinutesOfDay(T0, "UTC")).toBe(22 * 60 + 13);
  });

  it("falls back instead of throwing on a bogus zone", () => {
    expect(localMinutesOfDay(T0, "Not/AZone")).toBe(22 * 60 + 13);
  });
});

describe("autoStopCap", () => {
  it("is null when the clock is not running", () => {
    expect(autoStopCap(null, 1020)).toBe(null);
  });

  it("falls back to the flat ceiling with no schedule", () => {
    expect(autoStopCap(T0, null)).toBe(T0 + MAX_SEGMENT_MS);
  });

  it("caps at shift end plus grace", () => {
    // Started 14:13 local, shift ends 17:00 (1020) → 167 min + grace.
    const cap = autoStopCap(T0, 1020, "America/Los_Angeles");
    expect(cap).toBe(T0 + (167 + AUTO_STOP_GRACE_MIN) * 60_000);
  });

  it("falls back to the ceiling when started after shift end", () => {
    // 14:13 local start, shift ended at 12:00 — schedule tells us nothing.
    expect(autoStopCap(T0, 720, "America/Los_Angeles")).toBe(T0 + MAX_SEGMENT_MS);
  });

  it("never exceeds the flat ceiling", () => {
    const cap = autoStopCap(T0, 1439, "UTC");
    expect(cap).toBeLessThanOrEqual(T0 + MAX_SEGMENT_MS);
  });

  it("stops a forgotten overnight timer well short of the real elapsed", () => {
    const cap = autoStopCap(T0, 1020, "America/Los_Angeles")!;
    const overnight = elapsedFor(slot(), T0 + 16 * HOUR, cap);
    expect(overnight.work).toBeLessThan(5 * HOUR);
  });
});

describe("wasAutoStopped", () => {
  it("is true only once the cap has actually passed", () => {
    const cap = T0 + 2 * HOUR;
    expect(wasAutoStopped(slot(), T0 + HOUR, cap)).toBe(false);
    expect(wasAutoStopped(slot(), T0 + 3 * HOUR, cap)).toBe(true);
  });

  it("is false for a slot that is not accruing", () => {
    expect(wasAutoStopped(slot({ status: "paused" }), T0 + 9 * HOUR, T0)).toBe(false);
    expect(wasAutoStopped(slot({ startTime: null }), T0 + 9 * HOUR, T0)).toBe(false);
    // Unknown wall clock can't have passed a deadline.
    expect(wasAutoStopped(slot(), null, T0)).toBe(false);
  });
});

describe("status coverage", () => {
  it("every status has a bucket decision, label, and tone", () => {
    expect(TIMER_STATUSES).toHaveLength(4);
    for (const s of TIMER_STATUSES) {
      expect(bucketFor(s)).not.toBeUndefined();
      expect(unpaidKindFor(s)).not.toBeUndefined();
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
    }
  });

  it("gives the two hold reasons different tones so they read apart", () => {
    expect(STATUS_TONE.hold_parts).not.toBe(STATUS_TONE.hold_approval);
  });
});
