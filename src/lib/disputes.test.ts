import { describe, it, expect } from "vitest";
import {
  RECOVERY_EPS,
  MIN_INSIGHT_SAMPLE,
  daysWaiting,
  disputeFromPack,
  disputeOutcome,
  isClosed,
  lifetimeRecovery,
  nextStatus,
  outcomeInsights,
  sumLineRecovery,
} from "./disputes";
import type { DisputePack } from "./dispute-pack";
import type { Dispute, DisputeLine } from "./types";

function line(over: Partial<DisputeLine> = {}): DisputeLine {
  return {
    id: "dl",
    disputeId: "d",
    entryId: null,
    lineId: null,
    roNumber: "1001",
    code: "BRK-F",
    description: "Front brakes",
    workDate: "2026-07-05",
    flaggedHours: 1.5,
    paidHours: 1,
    claimedHours: 0.5,
    claimedDollars: 16,
    recoveredHours: 0,
    recoveredDollars: null,
    hadPhoto: false,
    position: 0,
    ...over,
  };
}

function dispute(over: Partial<Dispute> = {}): Dispute {
  return {
    id: "d",
    userId: "u",
    periodKey: "2026-07-P2",
    periodLabel: "Jul 16 - Jul 31, 2026",
    scope: "lines",
    status: "generated",
    claimedHours: 4,
    claimedDollars: 128,
    recoveredHours: 0,
    recoveredDollars: null,
    generatedAt: "2026-07-29T10:00:00.000Z",
    submittedAt: null,
    answeredAt: null,
    resolvedAt: null,
    note: "",
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:00:00.000Z",
    lines: [],
    ...over,
  };
}

describe("isClosed / nextStatus", () => {
  it("treats only resolved and withdrawn as closed", () => {
    expect(isClosed("generated")).toBe(false);
    expect(isClosed("submitted")).toBe(false);
    expect(isClosed("answered")).toBe(false);
    expect(isClosed("resolved")).toBe(true);
    expect(isClosed("withdrawn")).toBe(true);
  });

  it("walks the happy path and stops at the end", () => {
    expect(nextStatus("generated")).toBe("submitted");
    expect(nextStatus("submitted")).toBe("answered");
    expect(nextStatus("answered")).toBe("resolved");
    expect(nextStatus("resolved")).toBeNull();
  });

  it("never routes to withdrawn — dropping a claim is an explicit choice", () => {
    const reachable = (
      ["generated", "submitted", "answered", "resolved", "withdrawn"] as const
    ).map(nextStatus);
    expect(reachable).not.toContain("withdrawn");
  });
});

describe("disputeOutcome", () => {
  it("is open until the dispute closes", () => {
    expect(disputeOutcome(dispute({ status: "generated" }))).toBe("open");
    expect(disputeOutcome(dispute({ status: "submitted" }))).toBe("open");
    // Answered but not closed out is still open — they replied, it isn't settled.
    expect(disputeOutcome(dispute({ status: "answered" }))).toBe("open");
  });

  it("is full when the whole claim came back", () => {
    expect(
      disputeOutcome(
        dispute({ status: "resolved", claimedHours: 4, recoveredHours: 4 }),
      ),
    ).toBe("full");
  });

  it("is full within the rounding tolerance", () => {
    expect(
      disputeOutcome(
        dispute({
          status: "resolved",
          claimedHours: 4,
          recoveredHours: 4 - RECOVERY_EPS,
        }),
      ),
    ).toBe("full");
  });

  it("is partial when some but not all came back", () => {
    expect(
      disputeOutcome(
        dispute({ status: "resolved", claimedHours: 4, recoveredHours: 2.5 }),
      ),
    ).toBe("partial");
  });

  it("is denied when nothing came back", () => {
    expect(
      disputeOutcome(
        dispute({ status: "resolved", claimedHours: 4, recoveredHours: 0 }),
      ),
    ).toBe("denied");
  });

  it("counts a withdrawn claim with nothing recovered as denied", () => {
    expect(
      disputeOutcome(
        dispute({ status: "withdrawn", claimedHours: 4, recoveredHours: 0 }),
      ),
    ).toBe("denied");
  });

  it("counts a withdrawn claim that was partly paid as partial — the money arrived", () => {
    expect(
      disputeOutcome(
        dispute({ status: "withdrawn", claimedHours: 4, recoveredHours: 1 }),
      ),
    ).toBe("partial");
  });

  it("treats a zero-hour claim as full, not denied — nothing was owed", () => {
    expect(
      disputeOutcome(
        dispute({ status: "resolved", claimedHours: 0, recoveredHours: 0 }),
      ),
    ).toBe("full");
  });
});

describe("lifetimeRecovery", () => {
  it("returns an empty ledger with unknown rates for no disputes", () => {
    const r = lifetimeRecovery([]);
    expect(r.disputeCount).toBe(0);
    expect(r.claimedHours).toBe(0);
    expect(r.recoveredHours).toBe(0);
    // Unknown, not zero — a win rate over zero decided claims is not 0%.
    expect(r.winRate).toBeNull();
    expect(r.hourRecoveryRate).toBeNull();
    expect(r.claimedDollars).toBeNull();
    expect(r.recoveredDollars).toBeNull();
  });

  it("sums hours and dollars across disputes", () => {
    const r = lifetimeRecovery([
      dispute({
        status: "resolved",
        claimedHours: 4,
        claimedDollars: 128,
        recoveredHours: 4,
        recoveredDollars: 128,
      }),
      dispute({
        id: "d2",
        status: "resolved",
        claimedHours: 2,
        claimedDollars: 64,
        recoveredHours: 1,
        recoveredDollars: 32,
      }),
    ]);
    expect(r.claimedHours).toBe(6);
    expect(r.recoveredHours).toBe(5);
    expect(r.claimedDollars).toBe(192);
    expect(r.recoveredDollars).toBe(160);
    expect(r.fullCount).toBe(1);
    expect(r.partialCount).toBe(1);
    expect(r.deniedCount).toBe(0);
  });

  it("keeps dollars null when no dispute carried a dollar value", () => {
    const r = lifetimeRecovery([
      dispute({
        status: "resolved",
        claimedDollars: null,
        recoveredHours: 4,
        recoveredDollars: null,
      }),
    ]);
    expect(r.claimedDollars).toBeNull();
    expect(r.recoveredDollars).toBeNull();
    // Hours are still fully reported — an unpriced period is not an unknown ask.
    expect(r.recoveredHours).toBe(4);
  });

  it("reports the dollars it knows about in a mixed priced/unpriced set", () => {
    const r = lifetimeRecovery([
      dispute({ status: "resolved", claimedDollars: 100, recoveredDollars: 100 }),
      dispute({ id: "d2", status: "resolved", claimedDollars: null, recoveredDollars: null }),
    ]);
    expect(r.claimedDollars).toBe(100);
    expect(r.recoveredDollars).toBe(100);
  });

  it("counts open claims in claimed totals but excludes them from rates", () => {
    const r = lifetimeRecovery([
      dispute({
        status: "resolved",
        claimedHours: 4,
        recoveredHours: 4,
        recoveredDollars: 128,
      }),
      dispute({ id: "d2", status: "submitted", claimedHours: 10 }),
    ]);
    expect(r.claimedHours).toBe(14);
    expect(r.openCount).toBe(1);
    expect(r.closedCount).toBe(1);
    // The pending 10h claim must not drag the rates down.
    expect(r.winRate).toBe(1);
    expect(r.hourRecoveryRate).toBe(1);
  });

  it("computes win rate over closed claims only", () => {
    const r = lifetimeRecovery([
      dispute({ id: "a", status: "resolved", claimedHours: 2, recoveredHours: 2 }),
      dispute({ id: "b", status: "resolved", claimedHours: 2, recoveredHours: 1 }),
      dispute({ id: "c", status: "resolved", claimedHours: 2, recoveredHours: 0 }),
      dispute({ id: "d", status: "generated", claimedHours: 2 }),
    ]);
    // 2 of 3 closed claims recovered something.
    expect(r.winRate).toBeCloseTo(2 / 3);
    // 3 of 6 closed claimed hours came back.
    expect(r.hourRecoveryRate).toBeCloseTo(0.5);
  });

  it("reports an unknown hour-recovery rate when closed claims total zero hours", () => {
    const r = lifetimeRecovery([
      dispute({ status: "resolved", claimedHours: 0, recoveredHours: 0 }),
    ]);
    expect(r.hourRecoveryRate).toBeNull();
    expect(r.winRate).toBe(1);
  });
});

describe("outcomeInsights", () => {
  // n resolved disputes of one scope, `won` of which recovered something.
  function batch(
    scope: "lines" | "period",
    n: number,
    won: number,
    opts: { photo?: boolean } = {},
  ): Dispute[] {
    return Array.from({ length: n }, (_, i) =>
      dispute({
        id: `${scope}-${opts.photo ? "p" : "n"}-${i}`,
        scope,
        status: "resolved",
        claimedHours: 2,
        recoveredHours: i < won ? 2 : 0,
        lines:
          scope === "lines" ? [line({ hadPhoto: opts.photo ?? false })] : [],
      }),
    );
  }

  it("stays silent for a new user", () => {
    expect(outcomeInsights([])).toEqual([]);
  });

  it("stays silent below the minimum sample on either side", () => {
    const disputes = [
      ...batch("lines", MIN_INSIGHT_SAMPLE, MIN_INSIGHT_SAMPLE),
      ...batch("period", MIN_INSIGHT_SAMPLE - 1, 0),
    ];
    expect(outcomeInsights(disputes).find((i) => i.id === "scope")).toBeUndefined();
  });

  it("stays silent when both rates are identical", () => {
    const disputes = [
      ...batch("lines", 4, 2),
      ...batch("period", 4, 2),
    ];
    expect(outcomeInsights(disputes).find((i) => i.id === "scope")).toBeUndefined();
  });

  it("reports itemized claims winning more often than period totals", () => {
    const disputes = [
      ...batch("lines", 4, 4), // 100%
      ...batch("period", 4, 1), // 25%
    ];
    const insight = outcomeInsights(disputes).find((i) => i.id === "scope");
    expect(insight).toBeDefined();
    expect(insight!.betterLabel).toBe("Itemized by RO");
    expect(insight!.betterRate).toBe(1);
    expect(insight!.worseLabel).toBe("Period total");
    expect(insight!.worseRate).toBe(0.25);
    expect(insight!.betterCount).toBe(4);
  });

  it("flips the comparison when period totals actually do better", () => {
    const disputes = [
      ...batch("lines", 4, 1),
      ...batch("period", 4, 4),
    ];
    const insight = outcomeInsights(disputes).find((i) => i.id === "scope");
    expect(insight!.betterLabel).toBe("Period total");
    expect(insight!.worseLabel).toBe("Itemized by RO");
  });

  it("reports photo-backed claims winning more often", () => {
    const disputes = [
      ...batch("lines", 4, 4, { photo: true }),
      ...batch("lines", 4, 1, { photo: false }),
    ];
    const insight = outcomeInsights(disputes).find((i) => i.id === "photo");
    expect(insight).toBeDefined();
    expect(insight!.betterLabel).toBe("With a photo on file");
    expect(insight!.betterRate).toBe(1);
    expect(insight!.worseRate).toBe(0.25);
  });

  it("excludes period-total claims from the photo comparison", () => {
    // Period claims have no lines, so they can't count as "no photo" — otherwise
    // every aggregate claim would pollute the evidence comparison.
    const disputes = [
      ...batch("lines", 4, 4, { photo: true }),
      ...batch("period", 8, 0),
    ];
    expect(outcomeInsights(disputes).find((i) => i.id === "photo")).toBeUndefined();
  });
});

describe("daysWaiting", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");

  it("is null before the claim is handed over", () => {
    expect(daysWaiting(dispute({ submittedAt: null }), now)).toBeNull();
  });

  it("counts whole days since submission", () => {
    expect(
      daysWaiting(
        dispute({ status: "submitted", submittedAt: "2026-07-19T12:00:00.000Z" }),
        now,
      ),
    ).toBe(10);
  });

  it("stops counting once they answer", () => {
    expect(
      daysWaiting(
        dispute({
          status: "answered",
          submittedAt: "2026-07-19T12:00:00.000Z",
          answeredAt: "2026-07-22T12:00:00.000Z",
        }),
        now,
      ),
    ).toBeNull();
  });

  it("stops counting once the claim closes", () => {
    expect(
      daysWaiting(
        dispute({
          status: "resolved",
          submittedAt: "2026-07-19T12:00:00.000Z",
        }),
        now,
      ),
    ).toBeNull();
  });

  it("is null for a submission timestamp in the future", () => {
    expect(
      daysWaiting(
        dispute({ status: "submitted", submittedAt: "2026-08-05T12:00:00.000Z" }),
        now,
      ),
    ).toBeNull();
  });
});

describe("disputeFromPack", () => {
  function pack(over: Partial<DisputePack> = {}): DisputePack {
    return {
      periodLabel: "Jul 16 - Jul 31, 2026",
      techName: "Liem",
      generatedDate: "Jul 29, 2026",
      lines: [],
      totalShortHours: 0,
      totalShortDollars: null,
      hasRates: false,
      disputedRoCount: 0,
      photosAvailable: 0,
      unpaidRework: null,
      ...over,
    };
  }

  it("freezes an itemized pack into a lines-scoped claim", () => {
    const result = disputeFromPack(
      pack({
        lines: [
          {
            entryId: "e1",
            roNumber: "1001",
            date: "2026-07-20",
            code: "BRK-F",
            description: "Front brakes",
            status: "short",
            flagged: 1.5,
            paid: 1,
            deltaHours: 0.5,
            deltaDollars: 16,
          },
        ],
        totalShortHours: 0.5,
        totalShortDollars: 16,
        hasRates: true,
        disputedRoCount: 1,
      }),
      "2026-07-P2",
    );
    expect(result.scope).toBe("lines");
    expect(result.periodKey).toBe("2026-07-P2");
    expect(result.periodLabel).toBe("Jul 16 - Jul 31, 2026");
    expect(result.claimedHours).toBe(0.5);
    expect(result.claimedDollars).toBe(16);
    expect(result.lines).toHaveLength(1);
    // Every displayed value is copied, not referenced.
    expect(result.lines![0]).toMatchObject({
      entryId: "e1",
      roNumber: "1001",
      code: "BRK-F",
      description: "Front brakes",
      workDate: "2026-07-20",
      flaggedHours: 1.5,
      paidHours: 1,
      claimedHours: 0.5,
      claimedDollars: 16,
    });
  });

  it("falls back to a period-scoped claim when the pack has no lines", () => {
    const result = disputeFromPack(
      pack({ totalShortHours: 4, totalShortDollars: 128, hasRates: true }),
      "2026-07-P1",
    );
    expect(result.scope).toBe("period");
    expect(result.lines).toEqual([]);
    expect(result.claimedHours).toBe(4);
  });

  it("keeps claimed dollars null for an unpriced pack", () => {
    const result = disputeFromPack(
      pack({ totalShortHours: 4, totalShortDollars: null }),
      "2026-07-P1",
    );
    expect(result.claimedDollars).toBeNull();
  });

  it("carries a pending line's null paid hours through", () => {
    const result = disputeFromPack(
      pack({
        lines: [
          {
            entryId: "e2",
            roNumber: "1002",
            date: "2026-07-21",
            code: "LOF",
            description: "Oil",
            status: "pending",
            flagged: 0.3,
            paid: null,
            deltaHours: 0.3,
            deltaDollars: null,
          },
        ],
        totalShortHours: 0.3,
      }),
      "2026-07-P2",
    );
    // null paid is a legitimate claim shape (never reconciled) and must not
    // collapse to 0 — "not reconciled" and "paid nothing" are different facts.
    expect(result.lines![0].paidHours).toBeNull();
  });

  it("excludes unpaid rework from the claimed total — it is a separate claim", () => {
    const result = disputeFromPack(
      pack({
        totalShortHours: 4,
        unpaidRework: {
          lines: [],
          totalHours: 9,
          totalDollars: null,
          byKind: [],
          hasRates: false,
        } as unknown as DisputePack["unpaidRework"],
      }),
      "2026-07-P2",
    );
    expect(result.claimedHours).toBe(4);
  });
});

describe("sumLineRecovery", () => {
  it("adds up per-line recoveries", () => {
    expect(
      sumLineRecovery([
        line({ recoveredHours: 0.5 }),
        line({ id: "dl2", recoveredHours: 1.25 }),
        line({ id: "dl3", recoveredHours: 0 }),
      ]),
    ).toBe(1.75);
  });

  it("is zero for no lines", () => {
    expect(sumLineRecovery([])).toBe(0);
  });
});
