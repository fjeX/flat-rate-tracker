import { describe, it, expect } from "vitest";
import {
  LINE_ID_ERA_START,
  RECOVERY_EPS,
  isLineIdEraClaim,
  MIN_INSIGHT_SAMPLE,
  claimTotal,
  daysWaiting,
  disputeFromPack,
  disputeOutcome,
  isClosed,
  lifetimeRecovery,
  nextStatus,
  outcomeInsights,
  pendingRecoveryApplication,
  periodRecoveryPlan,
  sumLineRecovery,
} from "./disputes";
import type { DisputePack } from "./dispute-pack";
import type { Dispute, DisputeLine, Entry, EntryOpCode } from "./types";

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

  // Label policy: the app-wide absolute 3-minute (0.05h) rounding tolerance,
  // same as reconcile.ts PAY_EPS. "full" is decided FIRST; "denied" means
  // literally nothing came back. The old order tested "recovered within 0.05 of
  // zero" first, which swallowed a 0.10h claim that got 0.05h back and called
  // it Denied, and called 0.03h back on a 3.0h ask Denied though money arrived.
  it.each([
    // [claimed, recovered, expected]
    [0.1, 0.05, "full"], // exactly 3 min light: a win by the rounding rule
    [0.1, 0.1, "full"],
    [0.1, 0.08, "full"],
    [0.1, 0, "denied"],
    [0.1, 0.01, "partial"], // a real 0.01h arrived: not a denial
    [3, 0.03, "partial"], // was "denied" under the old zero-tolerance branch
    [3, 2.96, "full"],
    [3, 1.5, "partial"],
    [0.05, 0, "full"], // nothing meaningful was owed: unchanged from before
    [0.05, 0.05, "full"],
    [0, 0, "full"],
  ] as const)(
    "labels claimed %s / recovered %s as %s",
    (claimedHours, recoveredHours, expected) => {
      for (const status of ["resolved", "withdrawn"] as const) {
        expect(
          disputeOutcome(dispute({ status, claimedHours, recoveredHours })),
        ).toBe(expected);
      }
    },
  );

  // Float hygiene at the boundary. Every numeric(5,2) pair exactly 0.05h apart
  // is a full win, but `claimed - recovered` in IEEE-754 overshoots 0.05 for
  // most of them (0.14 - 0.09 = 0.05000000000000002) and the bare comparison
  // called those "partial" depending on the claim's value.
  it("labels every exactly-3-minute-light claim full, whatever its size", () => {
    const misses: number[] = [];
    for (let cents = 5; cents <= 2000; cents += 1) {
      const claimedHours = cents / 100;
      const recoveredHours = (cents - 5) / 100;
      const out = disputeOutcome(
        dispute({ status: "resolved", claimedHours, recoveredHours }),
      );
      if (out !== "full") misses.push(claimedHours);
    }
    expect(misses).toEqual([]);
  });

  it("counts a tiny fully-recovered claim as a win in the lifetime ledger", () => {
    const ledger = lifetimeRecovery([
      dispute({ status: "resolved", claimedHours: 0.1, recoveredHours: 0.05 }),
      dispute({ status: "resolved", claimedHours: 3, recoveredHours: 0.03 }),
      dispute({ status: "resolved", claimedHours: 3, recoveredHours: 0 }),
    ]);
    expect(ledger.fullCount).toBe(1);
    expect(ledger.partialCount).toBe(1);
    expect(ledger.deniedCount).toBe(1);
    expect(ledger.winRate).toBeCloseTo(2 / 3, 5);
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
            lineId: "L-brk",
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
      // The live row id is stored, so the recovery can be written back onto
      // exactly this row later (resolveLiveLines pass 0).
      lineId: "L-brk",
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
            lineId: "L-lof",
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

// ---------------------------------------------------------------------------
// pendingRecoveryApplication — the bridge between the two ledgers
// ---------------------------------------------------------------------------

function roLine(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: over.id ?? "l1",
    opCodeId: null,
    custom: true,
    customCode: "BRK-F",
    customDescription: "Front brakes",
    flagHours: 1.5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours: 1,
    ...over,
  };
}

function ro(lines: EntryOpCode[], over: Partial<Entry> = {}): Entry {
  return {
    id: over.id ?? "e1",
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date: "2026-07-20",
    roNumber: "1001",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
    ...over,
  };
}

describe("pendingRecoveryApplication", () => {
  it("maps a per-line recovery onto the live line by RO and code", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.5,
      lines: [line({ entryId: "e1", recoveredHours: 0.5 })],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].lineId).toBe("l1");
    expect(plan.rows[0].paidNow).toBe(1);
    expect(plan.rows[0].paidAfter).toBeCloseTo(1.5, 5);
    expect(plan.applyHours).toBeCloseTo(0.5, 5);
    expect(plan.unmappedHours).toBe(0);
  });

  it("offers nothing while the claim is still open", () => {
    const d = dispute({
      status: "submitted",
      recoveredHours: 0.5,
      lines: [line({ entryId: "e1", recoveredHours: 0.5 })],
    });
    expect(pendingRecoveryApplication(d, [ro([roLine()])], []).rows).toEqual([]);
  });

  // The re-offer loop: closing a claim never touched paidHours, so the period
  // stayed as short as it was and the offer came back forever.
  it("is idempotent — a line already moved past its claim-time paid hours is skipped", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.5,
      lines: [line({ entryId: "e1", paidHours: 1, recoveredHours: 0.5 })],
    });
    const after = [ro([roLine({ paidHours: 1.5 })])];
    expect(pendingRecoveryApplication(d, after, []).rows).toEqual([]);
  });

  // The case a "still short?" check would get wrong: a partial recovery leaves
  // the line short on purpose, so shortness cannot mean "not yet applied".
  it("does not re-apply a partial recovery that left the line short", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 1,
      lines: [
        line({ entryId: "e1", flaggedHours: 5, paidHours: 2, claimedHours: 3, recoveredHours: 1 }),
      ],
    });
    const before = [ro([roLine({ flagHours: 5, paidHours: 2 })])];
    expect(pendingRecoveryApplication(d, before, []).rows[0].paidAfter).toBeCloseTo(3, 5);
    const after = [ro([roLine({ flagHours: 5, paidHours: 3 })])];
    expect(pendingRecoveryApplication(d, after, []).rows).toEqual([]);
  });

  // The accretion bug: clearing a line back to Pending after a recovery was
  // applied used to RE-ARM the offer, because the only guard compared upward
  // (paidNow > paidAtClaim). Four consecutive taps walked a cleared line
  // 0 -> 4 -> 8 -> 12 -> 16 with hours the tech never typed.
  it("does not re-arm when a line is cleared back to Pending after the recovery was applied", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 4,
      lines: [
        line({
          entryId: "e1",
          flaggedHours: 16,
          paidHours: 12,
          claimedHours: 4,
          recoveredHours: 4,
        }),
      ],
    });
    // Applied once (12 -> 16), then the tech cleared the line back to Pending.
    const cleared = [ro([roLine({ flagHours: 16, paidHours: null })])];
    expect(pendingRecoveryApplication(d, cleared, []).rows).toEqual([]);

    // Every rung the old four-tap ladder climbed to is refused too, so even a
    // hand-typed value in the middle of it cannot restart the walk.
    for (const paid of [4, 8, 16]) {
      const at = [ro([roLine({ flagHours: 16, paidHours: paid })])];
      expect(pendingRecoveryApplication(d, at, []).rows).toEqual([]);
    }

    // The one value that IS still offered is the claim-time baseline itself —
    // a line reading exactly what the claim froze has not had this money
    // applied, and that is the whole point of the feature.
    const baseline = [ro([roLine({ flagHours: 16, paidHours: 12 })])];
    expect(pendingRecoveryApplication(d, baseline, []).rows[0].paidAfter).toBeCloseTo(16, 5);
  });

  // Proves the fix does not lean on the old ceiling, which only landed on the
  // true entitlement when paidAtClaim happened to be a multiple of the recovery.
  // 13 + 4 = 17; the old guard stopped a cleared line at 16.
  it("refuses a cleared line even when claim-time paid is not a multiple of the recovery", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 4,
      lines: [
        line({
          entryId: "e1",
          flaggedHours: 17,
          paidHours: 13,
          claimedHours: 4,
          recoveredHours: 4,
        }),
      ],
    });
    for (const paid of [null, 4, 8, 12, 16]) {
      const at = [ro([roLine({ flagHours: 17, paidHours: paid })])];
      expect(pendingRecoveryApplication(d, at, []).rows).toEqual([]);
    }
    // Still on its claim-time baseline: genuinely unapplied, still offered.
    const untouched = [ro([roLine({ flagHours: 17, paidHours: 13 })])];
    const plan = pendingRecoveryApplication(d, untouched, []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].paidAfter).toBeCloseTo(17, 5);
  });

  it("still offers a recovery that has never been applied to a pending line", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 1.5,
      lines: [
        line({ entryId: "e1", paidHours: null, claimedHours: 1.5, recoveredHours: 1.5 }),
      ],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine({ paidHours: null })])], []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].paidNow).toBe(null);
    expect(plan.rows[0].paidAfter).toBeCloseTo(1.5, 5);

    // ...and once applied, it is not offered again.
    const after = [ro([roLine({ paidHours: 1.5 })])];
    expect(pendingRecoveryApplication(d, after, []).rows).toEqual([]);
  });

  // Pending at claim time, later reconciled at zero: nothing has been paid on
  // this line under either reading, so the recovery is still owed — on a claim
  // that KNOWS its line (stored id). Without an id, pending vs paid-0 is not
  // evidence that this is the claimed line (wave 4: a pending twin read as a
  // deleted paid-0 line's), so a pre-id claim leaves it unmapped instead.
  it("still offers when a line pending at claim time was later reconciled at zero", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 1.5,
      createdAt: LINE_ID_ERA_START,
      lines: [
        line({ entryId: "e1", lineId: "l1", paidHours: null, claimedHours: 1.5, recoveredHours: 1.5 }),
      ],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine({ paidHours: 0 })])], []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].paidAfter).toBeCloseTo(1.5, 5);

    const legacy = pendingRecoveryApplication(
      { ...d, createdAt: "2026-07-29T10:00:00.000Z", lines: d.lines.map((l) => ({ ...l, lineId: null })) },
      [ro([roLine({ paidHours: 0 })])],
      [],
    );
    expect(legacy.rows).toEqual([]);
    expect(legacy.unmappedHours).toBe(1.5);
  });

  it("treats a settlement covering the whole ask as every line getting its claim", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 1, // no per-line breakdown recorded
      lines: [
        line({ id: "a", entryId: "e1", code: "BRK-F", claimedHours: 0.5 }),
        line({ id: "b", entryId: "e1", code: "ALN", claimedHours: 0.5 }),
      ],
    });
    const entries = [
      ro([
        roLine({ id: "l1", customCode: "BRK-F" }),
        roLine({ id: "l2", customCode: "ALN" }),
      ]),
    ];
    const plan = pendingRecoveryApplication(d, entries, []);
    expect(plan.rows.map((r) => r.lineId)).toEqual(["l1", "l2"]);
    expect(plan.applyHours).toBeCloseTo(1, 5);
  });

  it("refuses to split a partial settlement with no per-line breakdown", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.4,
      lines: [
        line({ id: "a", entryId: "e1", code: "BRK-F", claimedHours: 0.5 }),
        line({ id: "b", entryId: "e1", code: "ALN", claimedHours: 0.5 }),
      ],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toEqual([]);
    expect(plan.needsLineBreakdown).toBe(true);
    expect(plan.unmappedHours).toBeCloseTo(0.4, 5);
  });

  // A single-line claim is the normal close flow: recordDisputeOutcomeAction
  // writes recoveredHours on the claim and never on dispute_lines, so the
  // per-line breakdown is absent for almost every real claim. With one line
  // there is nothing to apportion, so the refusal above does not apply.
  it("applies a partial recovery to the only line on the claim", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 2, // partial: 3 was asked for
      lines: [
        line({ entryId: "e1", flaggedHours: 5, paidHours: 2, claimedHours: 3 }),
      ],
    });
    const plan = pendingRecoveryApplication(
      d,
      [ro([roLine({ flagHours: 5, paidHours: 2 })])],
      [],
    );
    expect(plan.rows).toHaveLength(1);
    // The RECOVERY, not the ask: applying claimedHours (3) here would write an
    // hour the shop never paid.
    expect(plan.rows[0].recoveredHours).toBeCloseTo(2, 5);
    expect(plan.rows[0].paidAfter).toBeCloseTo(4, 5); // frozen paid 2 + 2
    expect(plan.applyHours).toBeCloseTo(2, 5);
    expect(plan.unmappedHours).toBe(0);
    expect(plan.needsLineBreakdown).toBe(false);
  });

  // Same guard as every other branch: the offer is armed only while the live
  // line still reads exactly what the claim froze. One tap moves it to
  // paidAfter, which no longer matches, so a second tap is offered nothing.
  it("does not re-apply a single-line partial recovery once it has landed", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 2,
      lines: [
        line({ entryId: "e1", flaggedHours: 5, paidHours: 2, claimedHours: 3 }),
      ],
    });
    const after = [ro([roLine({ flagHours: 5, paidHours: 4 })])];
    const plan = pendingRecoveryApplication(d, after, []);
    expect(plan.rows).toEqual([]);
    expect(plan.applyHours).toBe(0);
    // Not "unmapped": the hours DID map to a live line, they are simply
    // already on it. matchedRecovery counts the match before the
    // already-applied guard skips it, so the card does not tell the tech 2h
    // went nowhere when 2h is sitting on the line in front of them.
    expect(plan.unmappedHours).toBe(0);
    expect(plan.needsLineBreakdown).toBe(false);
  });

  // Goodwill above the line's shortfall is written in full, exactly as the
  // per-line branch writes a per-line recovery above its claim: nothing in
  // this module clamps against claimed or flagged hours.
  it("applies a single-line recovery larger than the line's shortfall in full", () => {
    const d = dispute({
      status: "resolved",
      // claimedHours 0 on the line keeps fullSettlement false (it needs a
      // non-zero ask), so this lands on the single-line branch with a recovery
      // well above anything the line is short.
      recoveredHours: 2,
      lines: [
        line({ entryId: "e1", flaggedHours: 2, paidHours: 1.5, claimedHours: 0 }),
      ],
    });
    const plan = pendingRecoveryApplication(
      d,
      [ro([roLine({ flagHours: 2, paidHours: 1.5 })])],
      [],
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].paidAfter).toBeCloseTo(3.5, 5);
    expect(plan.unmappedHours).toBe(0);
  });

  // The multi-line refusal is untouched by the single-line branch.
  it("still refuses a partial settlement across two lines", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.4,
      lines: [
        line({ id: "a", entryId: "e1", code: "BRK-F", claimedHours: 0.5 }),
        line({ id: "b", entryId: "e1", code: "ALN", claimedHours: 0.5 }),
      ],
    });
    const entries = [
      ro([
        roLine({ id: "l1", customCode: "BRK-F" }),
        roLine({ id: "l2", customCode: "ALN" }),
      ]),
    ];
    const plan = pendingRecoveryApplication(d, entries, []);
    expect(plan.rows).toEqual([]);
    expect(plan.needsLineBreakdown).toBe(true);
  });

  it("reports goodwill above the ask as unmapped rather than writing it somewhere", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 2, // 0.5 claimed back, 1.5 goodwill
      lines: [line({ entryId: "e1", recoveredHours: 0.5 })],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.applyHours).toBeCloseTo(0.5, 5);
    expect(plan.unmappedHours).toBeCloseTo(1.5, 5);
  });

  it("counts a deleted RO's recovery as unmapped", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.5,
      lines: [line({ entryId: "gone", roNumber: "9999", recoveredHours: 0.5 })],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toEqual([]);
    expect(plan.unmappedHours).toBeCloseTo(0.5, 5);
  });

  it("never lands two claim rows on the same live line", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 1,
      lines: [
        line({ id: "a", entryId: "e1", recoveredHours: 0.5 }),
        line({ id: "b", entryId: "e1", recoveredHours: 0.5 }),
      ],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.unmappedHours).toBeCloseTo(0.5, 5);
  });

  it("picks the matching line when one RO carries the same code twice", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.5,
      lines: [line({ entryId: "e1", flaggedHours: 3, recoveredHours: 0.5 })],
    });
    const entries = [
      ro([
        roLine({ id: "l1", flagHours: 1.5 }),
        roLine({ id: "l2", flagHours: 3 }),
      ]),
    ];
    expect(pendingRecoveryApplication(d, entries, []).rows[0].lineId).toBe("l2");
  });

  // -------------------------------------------------------------------------
  // Accretion, second round: RECOVERY_EPS was doing two jobs at once
  // -------------------------------------------------------------------------
  //
  // The first fix armed the offer on `|paidNow - paidAtClaim| <= RECOVERY_EPS`,
  // i.e. it used a 0.05h ROUNDING TOLERANCE as an "has this line moved?" test.
  // Any per-line recovery of 0.05h or less does not move the live value far
  // enough to trip that tolerance, so the offer re-armed and the same hours were
  // written floor(RECOVERY_EPS / hours) + 1 times. These tests tap the button
  // repeatedly and count the writes.

  /**
   * Tap Apply until the app stops offering. Mirrors the real write path: each
   * tap sets the live line to the row's paidAfter, rounded the way
   * numeric(5,2) rounds it. Returns every value written, in order.
   */
  function tapUntilQuiet(
    d: Dispute,
    startPaid: number | null,
    flag: number,
    maxTaps = 25,
  ): number[] {
    const writes: number[] = [];
    let paid = startPaid;
    for (let i = 0; i < maxTaps; i += 1) {
      const plan = pendingRecoveryApplication(
        d,
        [ro([roLine({ flagHours: flag, paidHours: paid })])],
        [],
      );
      if (plan.rows.length === 0) break;
      paid = Math.round(plan.rows[0].paidAfter * 100) / 100;
      writes.push(paid);
    }
    return writes;
  }

  function tinyRecovery(hours: number): Dispute {
    return dispute({
      status: "resolved",
      recoveredHours: hours,
      lines: [
        line({
          entryId: "e1",
          flaggedHours: 2,
          paidHours: 0,
          claimedHours: hours,
          recoveredHours: hours,
        }),
      ],
    });
  }

  // The confirmed repro: a 2-minute correction, frozen paid 0, live paid 0.
  // Under the tolerance guard this wrote 0.03 and then 0.06 — the recovery
  // applied twice. Zero/zero is genuinely ambiguous, so ONE offer is correct;
  // a second write is not.
  it("applies a sub-tolerance 0.03h recovery at most once", () => {
    expect(tapUntilQuiet(tinyRecovery(0.03), 0, 2)).toEqual([0.03]);
  });

  // Smaller recovery, more re-applications under the old guard: 0.01h re-armed
  // all the way up to 0.06. Nothing about the bug was bounded to one re-offer.
  it("applies a 0.01h recovery at most once — the old guard wrote it six times", () => {
    expect(tapUntilQuiet(tinyRecovery(0.01), 0, 2)).toEqual([0.01]);
  });

  // Exactly on the old tolerance boundary and just under it. 0.05 is the worst
  // case for a `<=` comparison and 0.04 for the first re-arm after it.
  it("applies a recovery sitting exactly on RECOVERY_EPS at most once", () => {
    expect(RECOVERY_EPS).toBe(0.05); // the boundary these two cases probe
    expect(tapUntilQuiet(tinyRecovery(0.05), 0, 2)).toEqual([0.05]);
  });

  it("applies a recovery just under RECOVERY_EPS at most once", () => {
    expect(tapUntilQuiet(tinyRecovery(0.04), 0, 2)).toEqual([0.04]);
  });

  // The original 12/4 ladder, driven through the same tap loop rather than
  // asserted rung by rung: one write, landing on the true entitlement.
  it("walks the 12 + 4 ladder exactly one rung", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 4,
      lines: [
        line({
          entryId: "e1",
          flaggedHours: 16,
          paidHours: 12,
          claimedHours: 4,
          recoveredHours: 4,
        }),
      ],
    });
    expect(tapUntilQuiet(d, 12, 16)).toEqual([16]);
  });

  // The non-multiple case: 13 + 4 = 17. The pre-fix ceiling was arithmetic
  // coincidence and stopped a cleared line at 16, short of the entitlement.
  it("walks the 13 + 4 ladder exactly one rung, to 17 and not 16", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 4,
      lines: [
        line({
          entryId: "e1",
          flaggedHours: 17,
          paidHours: 13,
          claimedHours: 4,
          recoveredHours: 4,
        }),
      ],
    });
    expect(tapUntilQuiet(d, 13, 17)).toEqual([17]);
  });

  // The feature must survive the fix: a claim that has never been applied to an
  // untouched line is still offered, at every claim-time shape.
  it("still offers a never-applied recovery on an untouched line", () => {
    for (const frozen of [null, 0, 1, 13.25]) {
      const d = dispute({
        status: "resolved",
        recoveredHours: 1.5,
        lines: [
          line({
            entryId: "e1",
            flaggedHours: 20,
            paidHours: frozen,
            claimedHours: 1.5,
            recoveredHours: 1.5,
          }),
        ],
      });
      const plan = pendingRecoveryApplication(
        d,
        [ro([roLine({ flagHours: 20, paidHours: frozen })])],
        [],
      );
      expect(plan.rows).toHaveLength(1);
      expect(plan.rows[0].paidAfter).toBeCloseTo((frozen ?? 0) + 1.5, 5);
    }
  });

  // A live line one cent-equivalent off the frozen value has MOVED. Under the
  // 0.05 tolerance both of these read as "unmoved" and re-armed.
  it("treats a 0.01h move off the claim-time value as moved, in both directions", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.5,
      lines: [
        line({ entryId: "e1", flaggedHours: 2, paidHours: 1, recoveredHours: 0.5 }),
      ],
    });
    for (const paid of [1.01, 0.99, 1.04, 0.96]) {
      const at = [ro([roLine({ flagHours: 2, paidHours: paid })])];
      expect(pendingRecoveryApplication(d, at, []).rows).toEqual([]);
    }
  });

  // The residual, stated exactly and shown to be bounded. Zero/zero is the one
  // state the data genuinely cannot read, so it re-offers — but only once per
  // deliberate clear, never as a run-away ladder.
  it("re-offers a cleared zero/zero line exactly once per clear, never twice", () => {
    // Stored id: the pending-vs-0 read below is about the claimed line itself
    // (a pre-id claim can't use it to FIND the line — see wave 4).
    const d = dispute({
      status: "resolved",
      recoveredHours: 1.5,
      createdAt: LINE_ID_ERA_START,
      lines: [
        line({
          entryId: "e1",
          lineId: "l1",
          flaggedHours: 2,
          paidHours: null,
          claimedHours: 1.5,
          recoveredHours: 1.5,
        }),
      ],
    });
    // First round: pending at claim time, pending now — one write, then quiet.
    expect(tapUntilQuiet(d, null, 2)).toEqual([1.5]);
    // The tech clears the line back to Pending by hand. That is a deliberate
    // act and it buys exactly ONE more offer, not an unbounded ladder.
    expect(tapUntilQuiet(d, null, 2)).toEqual([1.5]);
    // Reconciled at zero reads the same as pending for this question, and is
    // likewise bounded to a single write.
    expect(tapUntilQuiet(d, 0, 2)).toEqual([1.5]);
  });

  // -------------------------------------------------------------------------
  // The "nothing to apply" shapes — pinned, not changed
  // -------------------------------------------------------------------------
  //
  // Every case below already behaved exactly this way; none was covered. They
  // are the states that return rows [] WITH unmappedHours > 0 and
  // needsLineBreakdown FALSE, which is the combination the card reads to decide
  // which explanation the tech gets. The card now depends on that combination
  // being reachable two distinct ways — with claim lines and without — so the
  // shapes are pinned here before anything is built on top of them.
  it("leaves a period-total claim's partial recovery entirely unmapped", () => {
    // The ordinary non-itemized claim: disputeFromPack stores scope "period"
    // with NO lines whenever the tech only had the stub's period totals. There
    // is nothing for the money to land on, and no per-line breakdown is missing
    // — there was never one to record.
    const d = dispute({
      scope: "period",
      status: "resolved",
      claimedHours: 12,
      recoveredHours: 4,
      lines: [],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toEqual([]);
    expect(plan.applyHours).toBe(0);
    expect(plan.unmappedHours).toBeCloseTo(4, 5);
    // FALSE despite being just as unmappable as the needsLineBreakdown case:
    // the early return keys on dispute.lines.length, which is 0 here.
    expect(plan.needsLineBreakdown).toBe(false);
  });

  it("leaves a period-total claim's FULL payback unmapped too", () => {
    // fullSettlement cannot fire for a period-total claim at any recovery size:
    // it is computed from the sum of the LINES' claimedHours, which is 0 with no
    // lines, and the branch requires claimed > 0. So a 100% win lands in exactly
    // the same state as the partial one above, with the whole recovery unmapped.
    const d = dispute({
      scope: "period",
      status: "resolved",
      claimedHours: 12,
      recoveredHours: 12,
      lines: [],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toEqual([]);
    expect(plan.unmappedHours).toBeCloseTo(12, 5);
    expect(plan.needsLineBreakdown).toBe(false);
  });

  it("leaves a single-line claim unmapped when its live line is gone", () => {
    // The singleLineRecovery branch reaches the loop and then findLiveLine
    // fails: the RO was deleted (dispute_lines' FKs are ON DELETE SET NULL, so
    // the claim row survives pointing at nothing) or its code string was
    // renamed, since the join matches on the CURRENT code.
    const d = dispute({
      status: "resolved",
      claimedHours: 3,
      recoveredHours: 1,
      lines: [line({ entryId: "gone", roNumber: "9999", claimedHours: 3 })],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toEqual([]);
    expect(plan.applyHours).toBe(0);
    expect(plan.unmappedHours).toBeCloseTo(1, 5);
    // Not a missing breakdown: this claim has a line, it just has no LIVE line.
    expect(plan.needsLineBreakdown).toBe(false);
  });

  it("leaves a full settlement unmapped when every claimed line is gone", () => {
    // Same dead end by the fullSettlement road: the whole ask came back, no
    // per-line recovery was recorded, and neither claimed line still resolves.
    const d = dispute({
      status: "resolved",
      claimedHours: 2,
      recoveredHours: 2,
      lines: [
        line({ id: "a", entryId: "gone1", roNumber: "9998", claimedHours: 1 }),
        line({ id: "b", entryId: "gone2", roNumber: "9999", claimedHours: 1 }),
      ],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toEqual([]);
    expect(plan.unmappedHours).toBeCloseTo(2, 5);
    expect(plan.needsLineBreakdown).toBe(false);
  });

  // -------------------------------------------------------------------------
  // The tolerance that wrote money: a one-line claim within RECOVERY_EPS
  // -------------------------------------------------------------------------
  //
  // A one-line claim within 0.05h of its ask used to take the fullSettlement
  // road and write the ASK. 0.10h asked, 0.05h back: 0.05 + 0.05 >= 0.10 read
  // as "full", and paid went 3.30 -> 3.40 when only 3.35 was paid. The rule
  // now: a one-line claim writes exactly what came back, capped at its ask
  // (anything above the ask is goodwill and stays unmapped).

  function oneLineClaim(
    claimedHours: number,
    recoveredHours: number,
    paidAtClaim: number,
    flag = 10,
  ): Dispute {
    return dispute({
      status: "resolved",
      claimedHours,
      recoveredHours,
      lines: [
        line({
          entryId: "e1",
          flaggedHours: flag,
          paidHours: paidAtClaim,
          claimedHours,
          // recoveredHours on the LINE left at 0: the normal close flow never
          // writes dispute_lines.recovered_hours, so usePerLine is false.
        }),
      ],
    });
  }

  it.each([
    // [claimed, recovered, paid at claim, expected apply, expected unmapped]
    [0.1, 0.05, 3.3, 0.05, 0], // the repro: 3.35, not 3.40
    [3, 2.96, 2, 2.96, 0], // within tolerance, still the exact recovery
    [0.1, 0.1, 3.3, 0.1, 0], // true full settlement: same as before
    [3, 1.5, 2, 1.5, 0], // ordinary partial: same as before
    [0.1, 0.01, 3.3, 0.01, 0],
    [0.5, 2, 1, 0.5, 1.5], // goodwill above the ask stays unmapped, as before
    [0.1, 0.12, 3.3, 0.1, 0], // sub-tolerance goodwill: unmapped, not reported
  ] as const)(
    "one-line claim %s asked / %s back on paid %s writes %s (unmapped %s)",
    (claimed, recovered, paid, apply, unmapped) => {
      const d = oneLineClaim(claimed, recovered, paid);
      const plan = pendingRecoveryApplication(
        d,
        [ro([roLine({ flagHours: 10, paidHours: paid })])],
        [],
      );
      expect(plan.rows).toHaveLength(1);
      expect(plan.applyHours).toBeCloseTo(apply, 5);
      expect(plan.rows[0].recoveredHours).toBeCloseTo(apply, 5);
      expect(plan.rows[0].paidAfter).toBeCloseTo(paid + apply, 5);
      expect(plan.unmappedHours).toBeCloseTo(unmapped, 5);
      expect(plan.needsLineBreakdown).toBe(false);
      // THE INVARIANT, stated directly.
      expect(plan.applyHours).toBeLessThanOrEqual(recovered + 1e-9);
    },
  );

  it("writes 3.35 not 3.40 for 0.05h back on a 0.10h one-line ask, and only once", () => {
    const d = oneLineClaim(0.1, 0.05, 3.3, 3.4);
    expect(tapUntilQuiet(d, 3.3, 3.4)).toEqual([3.35]);
    // Nothing left to explain: every recovered hour landed, so neither the
    // goodwill note nor the breakdown request can render beside the rows.
    const plan = pendingRecoveryApplication(
      d,
      [ro([roLine({ flagHours: 3.4, paidHours: 3.3 })])],
      [],
    );
    expect(plan.unmappedHours).toBe(0);
    expect(plan.needsLineBreakdown).toBe(false);
  });

  it("lets a second claim round recover the rest after a tiny one-line recovery", () => {
    // Round 1 applied: line now 3.35. Round 1 must stay quiet on it.
    const round1 = oneLineClaim(0.1, 0.05, 3.3, 3.4);
    const at335 = [ro([roLine({ flagHours: 3.4, paidHours: 3.35 })])];
    const quiet = pendingRecoveryApplication(round1, at335, []);
    expect(quiet.rows).toEqual([]);
    expect(quiet.unmappedHours).toBe(0);
    // Round 2 claims the remaining 0.05 against the 3.35 it froze, gets it,
    // and writes exactly one rung to 3.40.
    const round2 = oneLineClaim(0.05, 0.05, 3.35, 3.4);
    expect(tapUntilQuiet(round2, 3.35, 3.4)).toEqual([3.4]);
    // Round 1 is still quiet at 3.40 too: neither round re-arms the other.
    expect(
      pendingRecoveryApplication(
        round1,
        [ro([roLine({ flagHours: 3.4, paidHours: 3.4 })])],
        [],
      ).rows,
    ).toEqual([]);
  });

  it("still uses the per-line figure when a one-line claim has one recorded", () => {
    const d = dispute({
      status: "resolved",
      claimedHours: 0.1,
      recoveredHours: 0.05,
      lines: [
        line({ entryId: "e1", paidHours: 3.3, claimedHours: 0.1, recoveredHours: 0.05 }),
      ],
    });
    const plan = pendingRecoveryApplication(
      d,
      [ro([roLine({ paidHours: 3.3 })])],
      [],
    );
    expect(plan.applyHours).toBeCloseTo(0.05, 5);
    expect(plan.rows[0].paidAfter).toBeCloseTo(3.35, 5);
  });

  // Multi-line with no breakdown is deliberately NOT changed: within tolerance
  // it still writes every line's ask (a bounded <= 0.05h aggregate overshoot
  // that cannot be split without a schema change); outside it, it still asks.
  it("leaves the multi-line sub-tolerance behaviour exactly as it was", () => {
    const lines = [
      line({ id: "a", entryId: "e1", code: "BRK-F", claimedHours: 0.1 }),
      line({ id: "b", entryId: "e1", code: "ALN", claimedHours: 0.1 }),
    ];
    const entries = [
      ro([
        roLine({ id: "l1", customCode: "BRK-F" }),
        roLine({ id: "l2", customCode: "ALN" }),
      ]),
    ];
    const within = pendingRecoveryApplication(
      dispute({ status: "resolved", claimedHours: 0.2, recoveredHours: 0.16, lines }),
      entries,
      [],
    );
    expect(within.rows.map((r) => r.recoveredHours)).toEqual([0.1, 0.1]);
    expect(within.applyHours).toBeCloseTo(0.2, 5);
    expect(within.needsLineBreakdown).toBe(false);

    const outside = pendingRecoveryApplication(
      dispute({ status: "resolved", claimedHours: 0.2, recoveredHours: 0.1, lines }),
      entries,
      [],
    );
    expect(outside.rows).toEqual([]);
    expect(outside.needsLineBreakdown).toBe(true);
    expect(outside.unmappedHours).toBeCloseTo(0.1, 5);
  });

  it("leaves a within-tolerance one-line claim unmapped when its live line is gone", () => {
    const d = dispute({
      status: "resolved",
      claimedHours: 0.1,
      recoveredHours: 0.08,
      lines: [line({ entryId: "gone", roNumber: "9999", claimedHours: 0.1 })],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
    expect(plan.rows).toEqual([]);
    expect(plan.applyHours).toBe(0);
    // 0.08 is above the 0.05 reporting floor, so the goodwill/deleted-RO note
    // shows it; needsLineBreakdown stays false, so the two notes never both fire.
    expect(plan.unmappedHours).toBeCloseTo(0.08, 5);
    expect(plan.needsLineBreakdown).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// One 3-minute boundary: the "full" label and the multi-line apply gate agree
// ---------------------------------------------------------------------------
//
// The label had a float allowance at exactly 0.05h short and the multi-line
// fullSettlement gate did not, so ~half of all exact-0.05h two-line claims
// read "Paid in full" above a card saying the recovery "isn't recorded against
// individual lines" (and the reverse, via header-vs-line-sum float drift).

describe("full label and multi-line apply gate share one boundary", () => {
  // numeric(5,2) round-trip: the nearest double to the 2-dp decimal.
  const r2 = (x: number) => Math.round(x * 100) / 100;

  function twoLineClaim(a: number, b: number, recovered: number): Dispute {
    return dispute({
      status: "resolved",
      // Stored header, as disputeFromPack + numeric(5,2) would leave it.
      claimedHours: r2(a + b),
      recoveredHours: recovered,
      lines: [
        line({ id: "a", entryId: "e1", code: "A", claimedHours: a }),
        line({ id: "b", entryId: "e1", code: "B", claimedHours: b }),
      ],
    });
  }
  const live = [
    ro([
      roLine({ id: "la", customCode: "A" }),
      roLine({ id: "lb", customCode: "B" }),
    ]),
  ];

  function assertAgrees(a: number, b: number, recovered: number) {
    const d = twoLineClaim(a, b, recovered);
    const label = disputeOutcome(d);
    const plan = pendingRecoveryApplication(d, live, []);
    const applied = plan.rows.length === 2 && !plan.needsLineBreakdown;
    // "Paid in full" <=> the card can place it on the lines; never both
    // "full" and "enter the paid hours on each line yourself".
    expect({ a, b, recovered, full: label === "full" }).toEqual({
      a,
      b,
      recovered,
      full: applied,
    });
    expect(label === "full" && plan.needsLineBreakdown).toBe(false);
    return label;
  }

  it("lines 0.01 + 0.33, 0.29 back (exactly 0.05h short) is full AND applied", () => {
    expect(assertAgrees(0.01, 0.33, 0.29)).toBe("full");
    const plan = pendingRecoveryApplication(twoLineClaim(0.01, 0.33, 0.29), live, []);
    expect(plan.applyHours).toBeCloseTo(0.34, 5); // each line gets its ask
    expect(plan.needsLineBreakdown).toBe(false);
  });

  it("lines 0.07 + 0.10, 0.12 back (exactly 0.05h short) is full AND applied", () => {
    expect(assertAgrees(0.07, 0.1, 0.12)).toBe("full");
  });

  it("0.06h short stays partial and asks for the breakdown", () => {
    expect(assertAgrees(0.07, 0.1, 0.11)).toBe("partial");
    const plan = pendingRecoveryApplication(twoLineClaim(0.07, 0.1, 0.11), live, []);
    expect(plan.needsLineBreakdown).toBe(true);
  });

  it("sweep: every 2-line claim on the 0.01h grid, 0.04/0.05/0.06h short", () => {
    let fullAtBoundary = 0;
    let checked = 0;
    for (let i = 1; i <= 60; i++) {
      for (let j = 1; j <= 60; j++) {
        const a = i / 100;
        const b = j / 100;
        const claimed = r2(a + b);
        for (const gap of [0.04, 0.05, 0.06]) {
          const recovered = r2(claimed - gap);
          if (recovered <= 0) continue;
          const label = assertAgrees(a, b, recovered);
          checked++;
          if (gap <= 0.05) {
            expect({ a, b, gap, label }).toEqual({ a, b, gap, label: "full" });
            if (gap === 0.05) fullAtBoundary++;
          } else {
            expect({ a, b, gap, label }).toEqual({ a, b, gap, label: "partial" });
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(9000);
    expect(fullAtBoundary).toBeGreaterThan(3000);
  });

  it("sweep: goodwill exactly 0.05h over the ask is never reported; 0.06h always is", () => {
    for (let i = 1; i <= 500; i++) {
      const ask = i / 100;
      for (const over of [0.05, 0.06]) {
        const recovered = r2(ask + over);
        const d = dispute({
          status: "resolved",
          claimedHours: ask,
          recoveredHours: recovered,
          lines: [line({ entryId: "e1", claimedHours: ask })],
        });
        const plan = pendingRecoveryApplication(d, [ro([roLine()])], []);
        expect(plan.rows).toHaveLength(1);
        expect(plan.applyHours).toBeCloseTo(ask, 9); // capped at the ask
        expect({ ask, over, shown: plan.unmappedHours > 0 }).toEqual({
          ask,
          over,
          shown: over > 0.05,
        });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The claim total the label is judged against (claimTotal)
// ---------------------------------------------------------------------------
//
// The label used to read the HEADER while the Apply gate re-summed the LINES.
// They only diverge on a hand-edited backup, but when they did, the two
// answered "paid in full?" about different numbers. Every branch of
// disputeOutcome is walked here on the divergent reproducer, not just the one
// that moved — the 09-26 run found an epsilon change flipping "denied" to
// "full" in a branch nobody re-checked.
describe("claimTotal / disputeOutcome on a header that disagrees with its lines", () => {
  // Header says 4h; the one line asks for 3h.
  const divergent = (over: Partial<Dispute> = {}) =>
    dispute({
      status: "resolved",
      claimedHours: 4,
      lines: [line({ entryId: "e1", flaggedHours: 4, paidHours: 1, claimedHours: 3 })],
      ...over,
    });

  it("uses the line re-sum when there are lines", () => {
    expect(claimTotal(divergent())).toBe(3);
  });

  it("uses the header for a period-total claim (no lines)", () => {
    expect(claimTotal(dispute({ scope: "period", claimedHours: 12.4, lines: [] }))).toBe(12.4);
  });

  it("falls back to the header when no line recorded an ask", () => {
    expect(
      claimTotal(dispute({ claimedHours: 4, lines: [line({ claimedHours: 0 })] })),
    ).toBe(4);
  });

  it("full: 3h back on lines asking 3h is paid in full (it read 'partial' against the 4h header)", () => {
    expect(disputeOutcome(divergent({ recoveredHours: 3 }))).toBe("full");
    // And the Apply gate agrees: the one line gets its 3h.
    const plan = pendingRecoveryApplication(
      divergent({ recoveredHours: 3 }),
      [ro([roLine({ flagHours: 4, paidHours: 1 })])],
      [],
    );
    expect(plan.applyHours).toBeCloseTo(3, 9);
  });

  it("partial: some back, less than the lines asked", () => {
    expect(disputeOutcome(divergent({ recoveredHours: 1.5 }))).toBe("partial");
  });

  it("denied: nothing back stays denied", () => {
    expect(disputeOutcome(divergent({ recoveredHours: 0 }))).toBe("denied");
  });

  it("open: still open whatever the totals say", () => {
    expect(disputeOutcome(divergent({ status: "submitted", recoveredHours: 3 }))).toBe("open");
  });

  it("does not turn a denial into 'full' when every line's ask is zero", () => {
    // Re-summing to 0 would make coversClaim(0, 0) true — "Paid in full" on a
    // claim that got nothing. The header fallback keeps it a denial.
    expect(
      disputeOutcome(
        dispute({
          status: "resolved",
          claimedHours: 4,
          recoveredHours: 0,
          lines: [line({ claimedHours: 0 }), line({ id: "dl2", claimedHours: 0 })],
        }),
      ),
    ).toBe("denied");
  });

  it("changes nothing for an app-shaped claim (header == lines to float noise)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 against a 0.3 header.
    const d = (recoveredHours: number) =>
      dispute({
        status: "resolved",
        claimedHours: 0.3,
        recoveredHours,
        lines: [line({ claimedHours: 0.1 }), line({ id: "dl2", claimedHours: 0.2 })],
      });
    expect(disputeOutcome(d(0.3))).toBe("full");
    expect(disputeOutcome(d(0.25))).toBe("full"); // exactly 3 minutes short
    expect(disputeOutcome(d(0.2))).toBe("partial");
    expect(disputeOutcome(d(0))).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// Same-code tie-break at exactly 3 minutes (findLiveLine)
// ---------------------------------------------------------------------------
describe("findLiveLine tie-break between two lines of the same code", () => {
  it("never offers the wrong line when the claimed line's flag was edited by exactly 0.05h", () => {
    // The claim froze line B at 0.09h flagged. B was since bumped to 0.14h;
    // 0.14 - 0.09 is 0.05000000000000002, which a bare `<= RECOVERY_EPS` threw
    // out, so the claim fell through to candidates[0] — line A, a different
    // line — and the Apply panel offered to pay the wrong row.
    //
    // Since 09-27 wave 3 a flag-only match is report-only (resolveLiveLines
    // PASS 2): B is recognised within rounding, so A is never considered, and
    // B is not written either — without a stored line id "B's flag moved" and
    // "B is gone and this is a neighbour" look the same.
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.05,
      lines: [
        line({ entryId: "e1", flaggedHours: 0.09, paidHours: 0.04, claimedHours: 0.05 }),
      ],
    });
    const entries = [
      ro([
        roLine({ id: "A", flagHours: 3, paidHours: 0.04 }),
        roLine({ id: "B", flagHours: 0.14, paidHours: 0.04 }),
      ]),
    ];
    expect(0.14 - 0.09).toBeGreaterThan(RECOVERY_EPS); // the float trap is real
    const plan = pendingRecoveryApplication(d, entries, []);
    expect(plan.rows).toEqual([]);
    expect(plan.moved).toEqual([]);
    // With the line id stored (every claim raised since), it is simply B.
    const withId = { ...d, lines: [{ ...d.lines[0], lineId: "B" }] };
    expect(pendingRecoveryApplication(withId, entries, []).rows.map((r) => r.lineId)).toEqual(["B"]);
  });

  it("prefers the CLOSEST line when two are within 3 minutes, not the first", () => {
    // With exact-0.05h counted as a match, 1.00 and 1.05 both qualify for a
    // claim frozen at 1.05. First-match would hand it to 1.00.
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.5,
      lines: [line({ entryId: "e1", flaggedHours: 1.05, recoveredHours: 0.5 })],
    });
    const entries = [
      ro([
        roLine({ id: "A", flagHours: 1 }),
        roLine({ id: "B", flagHours: 1.05 }),
      ]),
    ];
    expect(pendingRecoveryApplication(d, entries, []).rows[0].lineId).toBe("B");
  });
});

// ---------------------------------------------------------------------------
// Resolving a whole claim's rows to live lines together (resolveLiveLines)
// ---------------------------------------------------------------------------
describe("live-line resolution across a claim's rows", () => {
  /** A per-line-recovery claim over same-code rows on RO 1001. */
  const claimOf = (
    rows: { flag: number; paid: number | null; rec: number }[],
  ) =>
    dispute({
      status: "resolved",
      recoveredHours: rows.reduce((s, r) => s + r.rec, 0),
      lines: rows.map((r, k) =>
        line({
          id: `dl${k + 1}`,
          entryId: "e1",
          flaggedHours: r.flag,
          paidHours: r.paid,
          claimedHours: r.rec,
          recoveredHours: r.rec,
          position: k,
        }),
      ),
    });
  const live = (id: string, flag: number, paid: number | null) =>
    roLine({ id, flagHours: flag, paidHours: paid });
  /** The write applyDisputeRecoveryAction makes: paidHours := paidAfter. */
  const applyTo = (
    entries: Entry[],
    rows: { lineId: string; paidAfter: number }[],
  ): Entry[] =>
    entries.map((e) => ({
      ...e,
      opCodes: e.opCodes.map((l) => {
        const r = rows.find((x) => x.lineId === l.id);
        return r ? { ...l, paidHours: r.paidAfter } : l;
      }),
    }));

  /**
   * The money invariant, end to end: tap Apply until nothing is offered, and
   * check no line is ever written twice and the claim never writes more hours
   * than it recovered. (A staged offer — some rows now, the rest after — is
   * allowed; paying anything twice is not.)
   */
  const applyUntilQuiet = (d: Dispute, entries: Entry[], ctx: string) => {
    const written = new Set<string>();
    let hours = 0;
    let now = entries;
    for (let tap = 0; tap < 6; tap++) {
      const plan = pendingRecoveryApplication(d, now, []);
      if (plan.rows.length === 0) break;
      for (const r of plan.rows) {
        expect(written.has(r.lineId), `${ctx} line ${r.lineId} written twice`).toBe(false);
        written.add(r.lineId);
        hours += r.recoveredHours;
      }
      now = applyTo(now, plan.rows);
    }
    expect(pendingRecoveryApplication(d, now, []).rows, ctx).toEqual([]);
    expect(hours, ctx).toBeLessThanOrEqual(d.recoveredHours + 1e-9);
  };

  it("doesn't let one row take another row's exact line (the wave-1 reproducer)", () => {
    // dl1 froze 1.00/0.5 — its line A has since had its flag bumped to 1.04.
    // dl2 froze 1.02/0.6 on line B, untouched. Closest-flag alone sent dl1 to
    // B (0.02 < 0.04), failed the paid guard there without reserving it, and
    // dl2 took B too: one row applied, dl1's recovery silently lost.
    const d = claimOf([
      { flag: 1.0, paid: 0.5, rec: 0.3 },
      { flag: 1.02, paid: 0.6, rec: 0.2 },
    ]);
    const A = live("A", 1.04, 0.5);
    const B = live("B", 1.02, 0.6);
    for (const order of [[A, B], [B, A]]) {
      const plan = pendingRecoveryApplication(d, [ro(order)], []);
      // dl2 keeps its own exact line. dl1's line was found by flag alone,
      // which is report-only since wave 3: not written, and NOT silently lost
      // either — its 0.3h reads as unmapped, so the card says so.
      expect(plan.rows.map((r) => [r.lineId, r.recoveredHours])).toEqual([
        ["B", 0.2],
      ]);
      expect(plan.unmappedHours).toBeCloseTo(0.3, 9);
      expect(plan.moved).toEqual([]);
    }
  });

  it("offers nothing a second time once the rows have been applied", () => {
    const d = claimOf([
      { flag: 1.0, paid: 0.5, rec: 0.3 },
      { flag: 1.02, paid: 0.6, rec: 0.2 },
    ]);
    const before = [ro([live("A", 1.04, 0.5), live("B", 1.02, 0.6)])];
    const plan = pendingRecoveryApplication(d, before, []);
    const after = applyTo(before, plan.rows);
    expect(pendingRecoveryApplication(d, after, []).rows).toEqual([]);
  });

  it("stays on its own twin after the write, even when the other twin lands on its frozen figure", () => {
    // Two BRK-F lines flagged 2.0 on one RO, both claimed. A froze 1.0 and
    // recovers 1.0; B froze 0.5 and recovers 0.5 — which puts B at exactly
    // 1.0, A's frozen figure. A matcher that only recognised "still reads the
    // frozen value" would, after the apply, pair A's row with B and offer
    // A's 1.0h again onto B.
    const d = claimOf([
      { flag: 2, paid: 1, rec: 1 },
      { flag: 2, paid: 0.5, rec: 0.5 },
    ]);
    const before = [ro([live("A", 2, 1), live("B", 2, 0.5)])];
    const plan = pendingRecoveryApplication(d, before, []);
    expect(plan.rows.map((r) => [r.lineId, r.paidAfter])).toEqual([
      ["A", 2],
      ["B", 1],
    ]);
    const after = applyTo(before, plan.rows);
    const again = pendingRecoveryApplication(d, after, []);
    expect(again.rows).toEqual([]);
    expect(again.moved.map((m) => [m.lineId, m.looksApplied])).toEqual([
      ["A", true],
      ["B", true],
    ]);
  });

  it("won't write through a twin cluster that another round has moved out from under it", () => {
    // Round 1 claimed twins A (froze 1.0) and B (froze 0.5), recovered 0.5 and
    // 0.3, applied: A 1.5, B 0.8. Round 2 claimed both again and its apply
    // took A to 1.9 and B to 1.0 — exactly round 1's frozen figure for A.
    // Round 1's A row now "matches" B with paid equal to what it froze, but A
    // itself is unexplained: offering it would write 0.5h onto B.
    const r1 = claimOf([
      { flag: 2, paid: 1, rec: 0.5 },
      { flag: 2, paid: 0.5, rec: 0.3 },
    ]);
    const now = [ro([live("A", 2, 1.9), live("B", 2, 1)])];
    const plan = pendingRecoveryApplication(r1, now, []);
    expect(plan.rows).toEqual([]);
    // Reserved and reported, never offered — and no line named twice.
    const ids = plan.moved.map((m) => m.lineId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a row with nothing to write still reserves its exact line", () => {
    // dl1 recovered nothing; its exact line is B. dl2 (froze 1.00/0.5) lost
    // its exact line to a flag edit (A, now 1.03). Without the reservation
    // dl2's closest-flag pick is B (0.01 away), which reads dl2's frozen paid
    // hours by coincidence — a write onto dl1's line.
    const d = claimOf([
      { flag: 1.01, paid: 0.5, rec: 0 },
      { flag: 1.0, paid: 0.5, rec: 0.4 },
    ]);
    const plan = pendingRecoveryApplication(
      d,
      [ro([live("B", 1.01, 0.5), live("A", 1.03, 0.5)])],
      [],
    );
    // B is never offered. A (flag-only) is report-only since wave 3, so the
    // 0.4h stays unmapped rather than being written anywhere.
    expect(plan.rows).toEqual([]);
    expect(plan.unmappedHours).toBeCloseTo(0.4, 9);
  });

  it("still honours a stored line id first, whatever the other rows want", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.7,
      lines: [
        line({ id: "dl1", entryId: "e1", flaggedHours: 1, paidHours: 0.5, recoveredHours: 0.3 }),
        line({ id: "dl2", entryId: "e1", lineId: "B", flaggedHours: 1, paidHours: 0.5, recoveredHours: 0.4 }),
      ],
    });
    const plan = pendingRecoveryApplication(
      d,
      [ro([live("B", 1, 0.5), live("A", 1, 0.5)])],
      [],
    );
    // A claim that stores ids stores one on EVERY row (disputeFromPack), so
    // dl1's null is a line deleted since (FK ON DELETE SET NULL) — it is not
    // handed to the heuristic, which would pick A, a line it never named.
    expect(plan.rows.map((r) => [r.lineId, r.recoveredHours])).toEqual([
      ["B", 0.4],
    ]);
    expect(plan.unmappedHours).toBeCloseTo(0.3, 9);
  });

  // THE GRID. Two rows × two same-code lines over a small value grid, both
  // line orders, two recovery sizes (0.1 makes "frozen + recovery" collide
  // with the other paid value, so applied/unapplied readings overlap).
  describe("2 rows × 2 lines grid", () => {
    const FLAGS = [1, 1.02, 1.04];
    const PAIDS = [0.5, 0.6];
    const PAIRS = FLAGS.flatMap((f) => PAIDS.map((p) => ({ f, p })));
    const exact = (
      a: { f: number; p: number },
      b: { flagHours: number; paidHours?: number | null },
    ) => Math.abs(a.f - b.flagHours) < 1e-9 && Math.abs(a.p - (b.paidHours ?? 0)) < 1e-9;

    type Case = {
      rows: { f: number; p: number }[];
      lines: EntryOpCode[];
      rec: number;
    };
    const cases: Case[] = [];
    for (const rec of [0.3, 0.1])
      for (const r1 of PAIRS)
        for (const r2 of PAIRS)
          for (const la of PAIRS)
            for (const lb of PAIRS)
              cases.push({
                rows: [r1, r2],
                lines: [live("A", la.f, la.p), live("B", lb.f, lb.p)],
                rec,
              });

    const planFor = (c: Case, lines: EntryOpCode[]) =>
      pendingRecoveryApplication(
        claimOf(c.rows.map((r) => ({ flag: r.f, paid: r.p, rec: c.rec }))),
        [ro(lines)],
        [],
      );
    /** Every assignment giving each row its own exact (flag + paid) line. */
    const perfectExact = (c: Case) =>
      [
        [c.lines[0], c.lines[1]],
        [c.lines[1], c.lines[0]],
      ].filter(([x, y]) => exact(c.rows[0], x) && exact(c.rows[1], y));

    it(`covers ${2 * 36 * 36} cases`, () => {
      expect(cases).toHaveLength(2 * 36 * 36);
    });

    it("(a) never resolves two rows to the same live line", () => {
      for (const c of cases) {
        for (const order of [c.lines, [...c.lines].reverse()]) {
          const plan = planFor(c, order);
          const ids = [...plan.rows.map((r) => r.lineId), ...plan.moved.map((m) => m.lineId)];
          expect(new Set(ids).size, JSON.stringify(c)).toBe(ids.length);
        }
      }
    });

    it("(b) finds the all-exact assignment whenever one exists", () => {
      let hit = 0;
      for (const c of cases) {
        const perfect = perfectExact(c);
        if (perfect.length === 0) continue;
        hit++;
        for (const order of [c.lines, [...c.lines].reverse()]) {
          const plan = planFor(c, order);
          // Rows come out in claim-row order; each must be that row's exact line.
          expect(plan.rows, JSON.stringify(c)).toHaveLength(2);
          plan.rows.forEach((row, k) => {
            const l = c.lines.find((x) => x.id === row.lineId)!;
            expect(exact(c.rows[k], l), JSON.stringify(c)).toBe(true);
          });
        }
      }
      expect(hit).toBeGreaterThan(50); // the property was actually exercised
    });

    it("(c) the answer doesn't depend on line order when the exact assignment is unique", () => {
      for (const c of cases) {
        if (perfectExact(c).length !== 1) continue;
        const fwd = planFor(c, c.lines).rows.map((r) => r.lineId);
        const rev = planFor(c, [...c.lines].reverse()).rows.map((r) => r.lineId);
        expect(rev, JSON.stringify(c)).toEqual(fwd);
      }
    });

    it("(d) tapping Apply until quiet never writes a line twice or more than was recovered", () => {
      for (const c of cases) {
        for (const order of [c.lines, [...c.lines].reverse()]) {
          applyUntilQuiet(
            claimOf(c.rows.map((r) => ({ flag: r.f, paid: r.p, rec: c.rec }))),
            [ro(order)],
            JSON.stringify(c),
          );
        }
      }
    });
  });

  // Same properties, three rows × three lines, seeded random draws from a grid
  // with more collisions (null paid, flags 0.05 apart, two recovery sizes).
  it("3 rows × 3 lines fuzz: no line twice, all-exact found, never paid twice", () => {
    let seed = 20260927;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const FLAGS = [1, 1.02, 1.05, 1.1];
    const PAIDS: (number | null)[] = [null, 0.4, 0.5, 0.6];
    const RECS = [0.1, 0.2];
    const pick = <T,>(xs: T[]) => xs[rnd(xs.length)];
    const eqPaid = (a: number | null, b: number | null | undefined) =>
      Math.abs((a ?? 0) - (b ?? 0)) < 1e-9;
    const PERMS = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    let exactCases = 0;
    for (let n = 0; n < 4000; n++) {
      const rows = [0, 1, 2].map(() => ({
        flag: pick(FLAGS),
        paid: pick(PAIDS),
        rec: pick(RECS),
      }));
      const lines = ["A", "B", "C"].map((id) => live(id, pick(FLAGS), pick(PAIDS)));
      const d = claimOf(rows);
      const ctx = JSON.stringify({ rows, lines: lines.map((l) => [l.id, l.flagHours, l.paidHours]) });
      const isExact = (k: number, l: EntryOpCode) =>
        Math.abs(rows[k].flag - l.flagHours) < 1e-9 && eqPaid(rows[k].paid, l.paidHours);
      const hasPerfect = PERMS.some((p) => p.every((j, k) => isExact(k, lines[j])));
      if (hasPerfect) exactCases++;
      for (const perm of [PERMS[0], PERMS[3], PERMS[5]]) {
        const order = perm.map((j) => lines[j]);
        const plan = pendingRecoveryApplication(d, [ro(order)], []);
        const ids = [...plan.rows.map((r) => r.lineId), ...plan.moved.map((m) => m.lineId)];
        expect(new Set(ids).size, ctx).toBe(ids.length); // (a)
        if (hasPerfect) {
          expect(plan.rows, ctx).toHaveLength(3); // (b)
          plan.rows.forEach((row, k) =>
            expect(isExact(k, lines.find((l) => l.id === row.lineId)!), ctx).toBe(true),
          );
        }
        applyUntilQuiet(d, [ro(order)], ctx); // (d)
      }
    }
    expect(exactCases).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Several closed rounds on one period (periodRecoveryPlan)
// ---------------------------------------------------------------------------
//
// The card used to plan the NEWEST closed round only, so closing a second
// round hid the first round's unapplied Apply forever.
describe("periodRecoveryPlan", () => {
  // Line X: flagged 5, paid 2 at claim time. Each round is a one-line claim.
  const roundOn = (
    id: string,
    recoveredHours: number,
    over: Partial<DisputeLine> = {},
  ) =>
    dispute({
      id,
      status: "resolved",
      claimedHours: 3,
      recoveredHours,
      lines: [
        line({
          disputeId: id,
          entryId: "e1",
          flaggedHours: 5,
          paidHours: 2,
          claimedHours: 3,
          ...over,
        }),
      ],
    });
  const liveX = (paidHours: number | null) =>
    roLine({ id: "X", flagHours: 5, paidHours });
  const liveY = (paidHours: number | null) =>
    roLine({ id: "Y", customCode: "ALN", flagHours: 4, paidHours });

  describe("same line in both rounds", () => {
    // R1 (older) and R2 (newer) both claim X with the same frozen paid (2):
    // R2 was raised before R1's recovery was applied.
    const r1 = roundOn("r1", 1);
    const r2 = roundOn("r2", 1);

    it("offers only the newest round while both are armed", () => {
      const plan = periodRecoveryPlan([r2, r1], [ro([liveX(2)])], []);
      // Both rounds are individually armed on X...
      expect(plan.rounds.map((r) => r.plan.rows.length)).toEqual([1, 1]);
      // ...but exactly one is offered.
      expect(plan.applyRound?.dispute.id).toBe("r2");
      expect(plan.disarmedHours).toBe(0);
    });

    it("applying one disarms the other, and says how much it stranded", () => {
      // The write R2's Apply makes: 2 + 1.
      const plan = periodRecoveryPlan([r2, r1], [ro([liveX(3)])], []);
      expect(plan.rounds.map((r) => r.plan.rows.length)).toEqual([0, 0]);
      expect(plan.applyRound).toBeNull(); // never offered as a second apply
      // R1's 1h matched a line and was NOT unmapped — without this field it
      // vanished from every figure the card shows.
      expect(plan.rounds[1].plan.unmappedHours).toBe(0);
      expect(plan.disarmedHours).toBeCloseTo(1, 9);
    });

    it("counts the stranded round's own hours when the amounts differ", () => {
      const r1b = roundOn("r1", 1.5);
      const plan = periodRecoveryPlan([r2, r1b], [ro([liveX(3)])], []);
      expect(plan.applyRound).toBeNull();
      expect(plan.disarmedHours).toBeCloseTo(1.5, 9);
    });

    it("counts both rounds when the line was edited by hand to neither value — capped at what the line is still short", () => {
      // Both rounds' 1h are unaccounted for (2h raw), but X reads 4 of 5
      // flagged: at most 1h can possibly be missing from it.
      const plan = periodRecoveryPlan([r2, r1], [ro([liveX(4)])], []);
      expect(plan.applyRound).toBeNull();
      expect(plan.disarmedHours).toBeCloseTo(1, 9);
      expect(plan.disarmedLines).toEqual([
        { lineId: "X", roNumber: "1001", code: "BRK-F", hours: expect.closeTo(1, 9) },
      ]);
    });
  });

  describe("different lines", () => {
    const r1 = roundOn("r1", 1); // X
    const r2 = roundOn("r2", 1, { code: "ALN", flaggedHours: 4, claimedHours: 2 }); // Y

    it("offers the newest round first", () => {
      const plan = periodRecoveryPlan([r2, r1], [ro([liveX(2), liveY(2)])], []);
      expect(plan.applyRound?.dispute.id).toBe("r2");
      expect(plan.applyRound?.plan.rows.map((r) => r.lineId)).toEqual(["Y"]);
    });

    it("offers the older round once the newer one is applied", () => {
      const plan = periodRecoveryPlan([r2, r1], [ro([liveX(2), liveY(3)])], []);
      expect(plan.applyRound?.dispute.id).toBe("r1");
      expect(plan.applyRound?.plan.rows.map((r) => r.lineId)).toEqual(["X"]);
      // Y moved, but only R2 ever claimed it: that is R2's own apply.
      expect(plan.disarmedHours).toBe(0);
    });

    it("offers nothing and strands nothing once both are applied", () => {
      const plan = periodRecoveryPlan([r2, r1], [ro([liveX(3), liveY(3)])], []);
      expect(plan.applyRound).toBeNull();
      expect(plan.disarmedHours).toBe(0);
    });
  });

  it("a single applied round strands nothing (its own write, or the tech's)", () => {
    const r = roundOn("r1", 1);
    expect(periodRecoveryPlan([r], [ro([liveX(3)])], []).disarmedHours).toBe(0);
    expect(periodRecoveryPlan([r], [ro([liveX(4)])], []).disarmedHours).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Stranded ("disarmed") hours never ask for more than the line is short
// ---------------------------------------------------------------------------
//
// The wave-1 figure summed every moved round's hours on a shared line, and the
// note under it told the tech to enter them by hand — including hours that had
// already landed, and hours that were the same shortage asked for twice. Each
// case below is a sequence the card can really reach.
describe("periodRecoveryPlan stranded hours", () => {
  /** A closed one-line round on line X (BRK-F on RO 1001). */
  const roundX = (
    id: string,
    o: { flag: number; frozen: number | null; ask: number; got: number },
  ) =>
    dispute({
      id,
      status: "resolved",
      claimedHours: o.ask,
      recoveredHours: o.got,
      lines: [
        line({
          disputeId: id,
          entryId: "e1",
          flaggedHours: o.flag,
          paidHours: o.frozen,
          claimedHours: o.ask,
        }),
      ],
    });
  const X = (flag: number, paid: number | null) =>
    [ro([roLine({ id: "X", flagHours: flag, paidHours: paid })])];

  it("D1: a round applied BEFORE the next round opened strands nothing", () => {
    // X flag 5 paid 1. R1 asks 4, gets 1, applied → 2. R2 then freezes 2,
    // asks 3, gets 3, applied → 5.
    const r1 = roundX("r1", { flag: 5, frozen: 1, ask: 4, got: 1 });
    const r2 = roundX("r2", { flag: 5, frozen: 2, ask: 3, got: 3 });
    const plan = periodRecoveryPlan([r2, r1], X(5, 5), []);
    expect(plan.applyRound).toBeNull();
    expect(plan.disarmedHours).toBe(0);
    expect(plan.disarmedLines).toEqual([]);
    // ...and before R2's apply, R2 is simply offered; R1 is still not stranded.
    const mid = periodRecoveryPlan([r2, r1], X(5, 2), []);
    expect(mid.applyRound?.dispute.id).toBe("r2");
    expect(mid.disarmedHours).toBe(0);
  });

  it("D2: two rounds claiming the SAME shortage, one applied, line now at flag — nothing to enter", () => {
    // X flag 3 paid 2. R1 and R2 both froze 2, asked 1, got 1; the newer was
    // applied → 3. Wave 1 said "1h can't be applied, enter it yourself",
    // which would take X to 4 on a 3h flag: a double-pay prompt.
    const r1 = roundX("r1", { flag: 3, frozen: 2, ask: 1, got: 1 });
    const r2 = roundX("r2", { flag: 3, frozen: 2, ask: 1, got: 1 });
    const plan = periodRecoveryPlan([r2, r1], X(3, 3), []);
    expect(plan.applyRound).toBeNull();
    expect(plan.disarmedHours).toBe(0);
  });

  it("D3: a hand-typed partial, then a round for the rest — nothing stranded before or after its apply", () => {
    // X flag 3, R1 froze 2 and got 1; the tech typed 2.5 by hand. R2 froze
    // 2.5, asked 0.5, got 0.5.
    const r1 = roundX("r1", { flag: 3, frozen: 2, ask: 1, got: 1 });
    const r2 = roundX("r2", { flag: 3, frozen: 2.5, ask: 0.5, got: 0.5 });
    const before = periodRecoveryPlan([r2, r1], X(3, 2.5), []);
    expect(before.applyRound?.dispute.id).toBe("r2"); // R2's Apply closes the gap
    expect(before.disarmedHours).toBe(0);
    const after = periodRecoveryPlan([r2, r1], X(3, 3), []);
    expect(after.applyRound).toBeNull();
    expect(after.disarmedHours).toBe(0);
  });

  it("a genuinely possibly-missing figure still shows, capped at the line's shortfall", () => {
    // X flag 5 paid 1. R1 and R2 both froze 1, each asked 4; R1 got 1, R2 got
    // 2, R2 applied → 3. R1's 1h may be missing (or may be inside R2's 2) —
    // X is 2h short, so the cap doesn't bite: 1h to CHECK.
    const r1 = roundX("r1", { flag: 5, frozen: 1, ask: 4, got: 1 });
    const r2 = roundX("r2", { flag: 5, frozen: 1, ask: 4, got: 2 });
    const plan = periodRecoveryPlan([r2, r1], X(5, 3), []);
    expect(plan.applyRound).toBeNull();
    expect(plan.disarmedHours).toBeCloseTo(1, 9);
    expect(plan.disarmedLines).toEqual([
      { lineId: "X", roNumber: "1001", code: "BRK-F", hours: expect.closeTo(1, 9) },
    ]);
  });

  it("caps the figure at the shortfall when the raw hours exceed it", () => {
    // Same, but R1 got 3: raw 3h, X only 2h short.
    const r1 = roundX("r1", { flag: 5, frozen: 1, ask: 4, got: 3 });
    const r2 = roundX("r2", { flag: 5, frozen: 1, ask: 4, got: 2 });
    expect(periodRecoveryPlan([r2, r1], X(5, 3), []).disarmedHours).toBeCloseTo(2, 9);
  });

  it("a later flag RAISE invents nothing: D2, then flag 3 -> 4", () => {
    const r1 = roundX("r1", { flag: 3, frozen: 2, ask: 1, got: 1 });
    const r2 = roundX("r2", { flag: 3, frozen: 2, ask: 1, got: 1 });
    const plan = periodRecoveryPlan([r2, r1], X(4, 3), []);
    expect(plan.applyRound).toBeNull();
    expect(plan.disarmedLines).toEqual([]);
  });

  it("nothing at or under the 3-minute boundary, and nothing on a line that reads paid", () => {
    // Both froze 1 on a 5.0 flag and asked 4; r1 got 1, r2 got 2, r2 applied
    // (3). Then the tech types the line up by hand.
    const r1 = roundX("r1", { flag: 5, frozen: 1, ask: 4, got: 1 });
    const r2 = roundX("r2", { flag: 5, frozen: 1, ask: 4, got: 2 });
    for (const paid of [4.95, 4.96, 4.99, 5]) {
      expect(periodRecoveryPlan([r2, r1], X(5, paid), []).disarmedLines, String(paid)).toEqual([]);
    }
    expect(periodRecoveryPlan([r2, r1], X(5, 4.94), []).disarmedHours).toBeCloseTo(0.06, 9);
    // Cleared back to pending is not "short" either: the tech un-reconciled it.
    expect(periodRecoveryPlan([r2, r1], X(5, null), []).disarmedLines).toEqual([]);
  });

  it("leaves out the line the offered Apply is about to write, then recomputes after it", () => {
    const r1 = roundX("r1", { flag: 5, frozen: 1, ask: 4, got: 2 });
    const r2 = roundX("r2", { flag: 5, frozen: 2, ask: 3, got: 1 });
    const before = periodRecoveryPlan([r2, r1], X(5, 2), []);
    expect(before.applyRound?.dispute.id).toBe("r2");
    expect(before.disarmedLines).toEqual([]);
    const after = periodRecoveryPlan([r2, r1], X(5, 3), []);
    expect(after.applyRound).toBeNull();
    expect(after.disarmedHours).toBeLessThanOrEqual(5 - 3 + 1e-9);
  });

  it("grid: never above (lowest frozen or live flag) − paid, never at or under 3 minutes, never beside its own Apply", () => {
    let shown = 0;
    let checked = 0;
    for (const f1 of [0, 1, 2])
      for (const f2 of [0, 1, 2, 2.5])
        for (const g1 of [0.5, 1, 2])
          for (const g2 of [0.5, 1, 2])
            for (const flagNow of [2.9, 3, 3.01, 3.06, 4])
              for (const paid of [null, 0, 1, 2, 2.5, 2.94, 2.95, 2.96, 3, 3.5, 4]) {
                const r1 = roundX("r1", { flag: 3, frozen: f1, ask: 3 - f1, got: Math.min(g1, 3 - f1) });
                const r2 = roundX("r2", { flag: 3, frozen: f2, ask: 3 - f2, got: Math.min(g2, 3 - f2) });
                const plan = periodRecoveryPlan([r2, r1], X(flagNow, paid), []);
                const ctx = JSON.stringify({ f1, f2, g1, g2, flagNow, paid });
                const cap = Math.max(0, Math.min(3, flagNow) - (paid ?? 0));
                expect(plan.disarmedHours, ctx).toBeLessThanOrEqual(cap + 1e-9);
                for (const l of plan.disarmedLines) {
                  expect(l.hours, ctx).toBeGreaterThan(RECOVERY_EPS + 1e-9);
                  shown++;
                }
                const offered = new Set(plan.applyRound?.plan.rows.map((r) => r.lineId) ?? []);
                expect(plan.disarmedLines.some((l) => offered.has(l.lineId)), ctx).toBe(false);
                checked++;
              }
    expect(checked).toBeGreaterThan(1000);
    expect(shown).toBeGreaterThan(20);
  });

  // The invariant under every sequence: the stranded figure plus what's on
  // the line never exceeds flag (the note can never talk the tech past flag),
  // and it is never negative.
  it("never exceeds flag − paid on any shared line (grid)", () => {
    const vals = [0, 0.5, 1, 2, 3];
    let checked = 0;
    for (const flag of [3, 5])
      for (const f1 of vals)
        for (const f2 of vals)
          for (const g1 of [0.5, 1, 2])
            for (const g2 of [0.5, 1, 2])
              for (const paid of [...vals, 4, 5]) {
                if (f1 >= flag || f2 >= flag) continue;
                const r1 = roundX("r1", { flag, frozen: f1, ask: flag - f1, got: Math.min(g1, flag - f1) });
                const r2 = roundX("r2", { flag, frozen: f2, ask: flag - f2, got: Math.min(g2, flag - f2) });
                const plan = periodRecoveryPlan([r2, r1], X(flag, paid), []);
                expect(plan.disarmedHours).toBeGreaterThanOrEqual(0);
                expect(
                  plan.disarmedHours,
                  JSON.stringify({ flag, f1, f2, g1, g2, paid }),
                ).toBeLessThanOrEqual(Math.max(0, flag - paid) + 1e-9);
                checked++;
              }
    expect(checked).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// 09-27 wave 3: stored line ids, settled rows, report-only pass 2
// ---------------------------------------------------------------------------
describe("resolving claim rows after the RO is edited (wave 3)", () => {
  // RO 5000, three custom MISC lines: A (flag 1.0, paid 0.5), B (flag 1.0,
  // pending), C (flag 0.3, pending, never claimed). The claim names A and B
  // and is settled in full: 1.5h back.
  const misc = (id: string, flag: number, paid: number | null) =>
    roLine({ id, customCode: "MISC", flagHours: flag, paidHours: paid });
  const claimAB = (ids: boolean) =>
    dispute({
      status: "resolved",
      claimedHours: 1.5,
      recoveredHours: 1.5,
      lines: [
        line({ id: "dA", entryId: "e1", lineId: ids ? "A" : null, roNumber: "5000", code: "MISC", flaggedHours: 1, paidHours: 0.5, claimedHours: 0.5 }),
        line({ id: "dB", entryId: "e1", lineId: ids ? "B" : null, roNumber: "5000", code: "MISC", flaggedHours: 1, paidHours: null, claimedHours: 1, position: 1 }),
      ],
    });
  const RO = (lines: EntryOpCode[]) => [ro(lines, { roNumber: "5000" })];
  const write = (entries: Entry[], rows: { lineId: string; paidAfter: number }[]) =>
    entries.map((e) => ({
      ...e,
      opCodes: e.opCodes.map((l) => {
        const r = rows.find((x) => x.lineId === l.id);
        return r ? { ...l, paidHours: r.paidAfter } : l;
      }),
    }));

  for (const ids of [false, true]) {
    const tag = ids ? "with stored line ids" : "without line ids";

    it(`${tag}: deleting A after the apply never re-offers onto C (was: C null -> 1.0, 2.5h written of 1.5h)`, () => {
      const d = claimAB(ids);
      const before = RO([misc("A", 1, 0.5), misc("B", 1, null), misc("C", 0.3, null)]);
      const first = pendingRecoveryApplication(d, before, []);
      expect(first.rows.map((r) => [r.lineId, r.paidAfter])).toEqual([["A", 1], ["B", 1]]);
      const applied = write(before, first.rows);
      // The tech deletes line A. (A stored id reads back null: FK SET NULL.)
      const dGone = ids
        ? { ...d, lines: d.lines.map((l) => (l.lineId === "A" ? { ...l, lineId: null } : l)) }
        : d;
      const afterDelete = RO(applied[0].opCodes.filter((l) => l.id !== "A"));
      const again = pendingRecoveryApplication(dGone, afterDelete, []);
      expect(again.rows).toEqual([]);
      // Without ids A's row is settled (its money visibly landed); with ids
      // it is a deleted line, reported unmapped.
      expect(again.unmappedHours).toBe(ids ? 0.5 : 0);
    });

    it(`${tag}: A recoded before the apply never writes C`, () => {
      const d = claimAB(ids);
      const now = RO([
        roLine({ id: "A", customCode: "OTHER", flagHours: 1, paidHours: 0.5 }),
        misc("B", 1, null),
        misc("C", 0.3, null),
      ]);
      const plan = pendingRecoveryApplication(d, now, []);
      expect(plan.rows.some((r) => r.lineId === "C")).toBe(false);
      // A recoded line IS still that line when the claim knows its id.
      expect(plan.rows.map((r) => r.lineId)).toEqual(ids ? ["A", "B"] : ["B"]);
    });
  }

  it("a row whose APPLIED evidence another row took is settled: matched, never written, not moved twice", () => {
    // Both rows applied (A 1.0, B 1.0), then A deleted: both rows read as
    // applied off B. One takes B; the other is settled. C is a same-flag
    // pending line that reads exactly like B's frozen state.
    const d = claimAB(false);
    const plan = pendingRecoveryApplication(d, RO([misc("B", 1, 1), misc("C", 1, null)]), []);
    expect(plan.rows).toEqual([]);
    expect(plan.unmappedHours).toBe(0);
    expect(plan.moved.map((m) => m.lineId)).toEqual(["B"]);
  });

  it("a stored line id wins after the line's flag AND code were edited", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.5,
      lines: [line({ entryId: "e1", lineId: "B", flaggedHours: 1.5, paidHours: 1, claimedHours: 0.5 })],
    });
    const now = [
      ro([
        roLine({ id: "A", flagHours: 1.5, paidHours: 1 }),
        roLine({ id: "B", customCode: "BRK-R", flagHours: 2.5, paidHours: 1 }),
      ]),
    ];
    const plan = pendingRecoveryApplication(d, now, []);
    expect(plan.rows.map((r) => [r.lineId, r.paidAfter])).toEqual([["B", 1.5]]);
    // ...and only once.
    expect(pendingRecoveryApplication(d, write(now, plan.rows), []).rows).toEqual([]);
  });

  it("a stored line id not among the live lines resolves to nothing, never to a look-alike", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 0.5,
      lines: [line({ entryId: "e1", lineId: "GONE", flaggedHours: 1.5, paidHours: 1, claimedHours: 0.5 })],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine({ id: "A", flagHours: 1.5, paidHours: 1 })])], []);
    expect(plan.rows).toEqual([]);
    expect(plan.unmappedHours).toBe(0.5);
  });

  it("the heuristic writes only an exact-flag match; a near or far flag is never written", () => {
    for (const flag of [0.3, 0.9, 0.95, 0.96, 0.99, 1, 1.01, 1.04, 1.05, 1.06, 1.5]) {
      const d = dispute({
        status: "resolved",
        recoveredHours: 0.5,
        lines: [line({ entryId: "e1", flaggedHours: 1, paidHours: 0.5, claimedHours: 0.5 })],
      });
      const plan = pendingRecoveryApplication(d, [ro([roLine({ id: "A", flagHours: flag, paidHours: 0.5 })])], []);
      expect(plan.rows.length, String(flag)).toBe(flag === 1 ? 1 : 0);
      if (flag !== 1) expect(plan.unmappedHours, String(flag)).toBe(0.5);
      // Paid moved: reported as moved only when the flag is within rounding.
      const moved = pendingRecoveryApplication(d, [ro([roLine({ id: "A", flagHours: flag, paidHours: 0.7 })])], []);
      expect(moved.rows).toEqual([]);
      expect(moved.moved.length, String(flag)).toBe(Math.abs(flag - 1) <= RECOVERY_EPS + 1e-9 ? 1 : 0);
    }
  });

  // THE SIMULATOR, cut down. Seeded random claims on one RO with 1-3 same-code
  // lines (plus sometimes a distinct one), three recovery modes, an optional
  // second round, and random tech edits between taps (flag +-0.01..0.1, paid
  // typed, line added, deleted, recoded). Tap the offered Apply until quiet.
  describe("apply-until-quiet simulator", () => {
    type SimLine = { id: string; code: string; flag: number; paid: number | null; born: number; typedBy: Set<string> };
    type Round = { idx: number; d: Dispute; own: Set<string>; mode: string };
    const run = (ids: boolean, n: number, seed0: number) => {
      let seed = seed0;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const out = { overRecovered: 0, lineTwice: 0, wrongLine: 0, wrongOverFlag: 0, newLine: 0, writes: 0 };
      for (let s = 0; s < n; s++) {
        let seq = 0;
        const mk = (code: string, born: number): SimLine => {
          const flag = pick([0.3, 1, 1, 1.02, 1.05, 1.1, 2]);
          let paid = pick<number | null>([null, null, 0, 0.5, 1]);
          if (paid !== null && paid > flag) paid = r2(flag / 2);
          return { id: `L${seq++}`, code, flag, paid, born, typedBy: new Set() };
        };
        const lines: SimLine[] = [];
        for (let k = pick([1, 2, 2, 3, 3]); k > 0; k--) lines.push(mk("MISC", -1));
        if (rnd() < 0.3) lines.push(mk("BRK", -1));
        const rounds: Round[] = [];
        const raise = (idx: number) => {
          const pend = rnd() < 0.6;
          const claimed = lines.filter((l) => (l.paid === null ? pend : l.flag - l.paid > 0.05 + 1e-9));
          if (claimed.length === 0) return;
          const mode =
            claimed.length === 1
              ? pick(["perLine", "full", "single"])
              : pick(["perLine", "full", "full", "partial"]);
          const dls = claimed.map((l, k) => {
            const ask = r2(l.flag - (l.paid ?? 0));
            return line({
              id: `dl${idx}-${k}`, disputeId: `d${idx}`, entryId: "e1", lineId: ids ? l.id : null,
              roNumber: "1001", code: l.code, flaggedHours: l.flag, paidHours: l.paid, claimedHours: ask,
              recoveredHours: mode === "perLine" ? pick([0, ask, r2(ask / 2)]) : 0, position: k,
            });
          });
          const ask = dls.reduce((t, l) => t + l.claimedHours, 0);
          let rec =
            mode === "perLine"
              ? r2(dls.reduce((t, l) => t + l.recoveredHours, 0) + pick([0, 0, 0.5]))
              : mode === "full"
                ? r2(ask + pick([-0.05, -0.03, 0, 0, 0.02, 0.5]))
                : mode === "single"
                  ? r2(pick([0.5, 1, 0.01]) * ask)
                  : r2(ask / 2);
          if (rec <= 0) rec = 0.01;
          rounds.push({
            idx,
            mode,
            own: new Set(claimed.map((l) => l.id)),
            d: dispute({
              id: `d${idx}`, status: "resolved", claimedHours: ask, recoveredHours: rec, lines: dls,
              // An id-carrying claim is one raised since ids were stored.
              ...(ids ? { createdAt: LINE_ID_ERA_START, generatedAt: LINE_ID_ERA_START } : {}),
            }),
          });
        };
        const edit = () => {
          const kind = pick(["flag", "flag", "paid", "add", "del", "recode"]);
          if (kind === "add") {
            lines.push(mk("MISC", rounds.length));
            return;
          }
          if (lines.length === 0) return;
          const l = pick(lines);
          if (kind === "flag") {
            l.flag = Math.max(0.1, r2(l.flag + pick([-0.1, -0.05, -0.01, 0.01, 0.02, 0.05, 0.06, 0.1])));
          } else if (kind === "paid") {
            l.paid = pick<number | null>([null, 0, 0.5, 1, l.flag, r2(l.flag / 2)]);
            l.typedBy = new Set(rounds.map((r) => r.d.id));
          } else if (kind === "recode") {
            l.code = "OTHER";
          } else {
            lines.splice(lines.indexOf(l), 1);
            for (const r of rounds) {
              r.d = { ...r.d, lines: r.d.lines.map((x) => (x.lineId === l.id ? { ...x, lineId: null } : x)) };
            }
          }
        };
        const entries = () => [
          ro(lines.map((l, k) => roLine({ id: l.id, customCode: l.code, flagHours: l.flag, paidHours: l.paid, position: k }))),
        ];

        raise(0);
        if (rounds.length === 0) continue;
        for (let e = pick([0, 1, 1, 2, 3]); e > 0; e--) edit();
        if (rnd() < 0.35) raise(1);
        const wrote = new Map<string, Set<string>>();
        const hours = new Map<string, number>();
        for (let step = 0; step < 10; step++) {
          const plan = periodRecoveryPlan([...rounds].reverse().map((r) => r.d), entries(), []);
          if (!plan.applyRound) {
            if (rnd() < 0.4) {
              edit();
              continue;
            }
            break;
          }
          const round = rounds.find((r) => r.d.id === plan.applyRound!.dispute.id)!;
          const w = wrote.get(round.d.id) ?? new Set<string>();
          wrote.set(round.d.id, w);
          for (const row of plan.applyRound.plan.rows) {
            const l = lines.find((x) => x.id === row.lineId)!;
            out.writes++;
            // Re-arming by typing the frozen figure back is the documented
            // KNOWN LIMIT (one re-offer per hand edit), not the matcher.
            const known = w.has(l.id) && l.typedBy.has(round.d.id);
            if (w.has(l.id) && !known) out.lineTwice++;
            if (l.born > round.idx) out.newLine++;
            if (!round.own.has(l.id)) {
              out.wrongLine++;
              if (row.paidAfter > l.flag + RECOVERY_EPS + 1e-9) out.wrongOverFlag++;
            }
            l.paid = row.paidAfter;
            l.typedBy.delete(round.d.id);
            w.add(l.id);
            if (!known) hours.set(round.d.id, (hours.get(round.d.id) ?? 0) + row.recoveredHours);
          }
          if (rnd() < 0.5) edit();
        }
        for (const r of rounds) {
          const slack = r.mode === "full" ? RECOVERY_EPS : 0;
          if ((hours.get(r.d.id) ?? 0) > r.d.recoveredHours + slack + 1e-9) out.overRecovered++;
        }
      }
      return out;
    };

    it("never writes over flag onto a line the claim didn't name, with or without ids", () => {
      expect(run(false, 3000, 7).wrongOverFlag).toBe(0);
      expect(run(true, 3000, 7).wrongOverFlag).toBe(0);
    });

    it("with stored ids: no line written twice, and never a line the claim didn't name", () => {
      // There used to be an "all-deleted residue" here: a claim whose EVERY
      // claimed line was deleted read all-null, looked pre-id, and ran the
      // heuristic. Id-era is now decided by the claim's creation time
      // (LINE_ID_ERA_START), so that residue is gone.
      for (const seed of [11, 19584, 2784, 1046, 795]) {
        const r = run(true, 3000, seed);
        expect(r.writes).toBeGreaterThan(1000);
        expect(r.lineTwice).toBe(0);
        expect(r.wrongLine).toBe(0);
        expect(r.overRecovered).toBe(0);
      }
    });
  });
});

describe("id-era decided per claim, and pending never matches paid 0 (wave 4)", () => {
  // RO 1001: L1 (code A, flag 0.3, paid 0 — short) and L2 (code A, flag 0.3,
  // pending). The claim names L1 only; 0.3h comes back.
  const A = (id: string, paid: number | null) =>
    roLine({ id, customCode: "A", flagHours: 0.3, paidHours: paid });
  const AFTER = "2026-09-28T09:00:00Z";
  const BEFORE = "2026-09-27T19:59:59Z";
  const claim = (createdAt: string, lineId: string | null) =>
    dispute({
      status: "resolved",
      claimedHours: 0.3,
      recoveredHours: 0.3,
      createdAt,
      generatedAt: createdAt,
      lines: [line({ entryId: "e1", lineId, code: "A", flaggedHours: 0.3, paidHours: 0, claimedHours: 0.3 })],
    });

  it("the reproducer, after the apply: deleting L1 never offers onto L2 (was: Apply 0.3h onto L2, 0.6h written of 0.3h)", () => {
    const d = claim(AFTER, "L1");
    const first = pendingRecoveryApplication(d, [ro([A("L1", 0), A("L2", null)])], []);
    expect(first.rows.map((r) => [r.lineId, r.paidAfter])).toEqual([["L1", 0.3]]);
    // L1 applied to 0.3, then deleted: its stored id reads back null.
    const gone = { ...d, lines: d.lines.map((l) => ({ ...l, lineId: null })) };
    const again = pendingRecoveryApplication(gone, [ro([A("L2", null)])], []);
    expect(again.rows).toEqual([]);
    expect(again.applyHours).toBe(0);
    expect(again.unmappedHours).toBe(0.3);
  });

  it("the reproducer, before any apply: a deleted claimed line's recovery never lands on its pending twin", () => {
    const gone = claim(AFTER, null); // L1 deleted before the tap
    for (const twinPaid of [null, 0]) {
      const plan = pendingRecoveryApplication(gone, [ro([A("L2", twinPaid)])], []);
      expect(plan.rows, String(twinPaid)).toEqual([]);
      expect(plan.unmappedHours, String(twinPaid)).toBe(0.3);
    }
  });

  it("the cutoff boundary: at LINE_ID_ERA_START is id-era, a millisecond before is not", () => {
    expect(LINE_ID_ERA_START).toBe("2026-09-27T20:00:00Z");
    const at = "2026-09-27T20:00:00Z";
    const justBefore = "2026-09-27T19:59:59.999Z";
    expect(isLineIdEraClaim({ createdAt: at })).toBe(true);
    // Postgres timestamptz as PostgREST returns it: offset form, microseconds.
    expect(isLineIdEraClaim({ createdAt: "2026-09-27T20:00:00.000001+00:00" })).toBe(true);
    expect(isLineIdEraClaim({ createdAt: "2026-09-27T13:00:00-07:00" })).toBe(true);
    expect(isLineIdEraClaim({ createdAt: justBefore })).toBe(false);
    expect(isLineIdEraClaim({ createdAt: "2026-09-27T12:59:59-07:00" })).toBe(false);
    // Unreadable -> id-era: the no-guess direction.
    expect(isLineIdEraClaim({ createdAt: "" })).toBe(true);

    // A legacy (pre-cutoff, all-null) claim whose line is still there and
    // unedited keeps the heuristic: identity by (entry, code, flag, paid).
    const legacyLive = pendingRecoveryApplication(claim(justBefore, null), [ro([A("L1", 0), A("L2", null)])], []);
    expect(legacyLive.rows.map((r) => r.lineId)).toEqual(["L1"]);
    // The same claim at the cutoff has no id to go on: unmapped, never a guess.
    const eraNull = pendingRecoveryApplication(claim(at, null), [ro([A("L1", 0), A("L2", null)])], []);
    expect(eraNull.rows).toEqual([]);
    expect(eraNull.unmappedHours).toBe(0.3);
    // With its id, at the cutoff, it finds L1 — and only L1.
    const eraId = pendingRecoveryApplication(claim(at, "L1"), [ro([A("L1", 0), A("L2", null)])], []);
    expect(eraId.rows.map((r) => r.lineId)).toEqual(["L1"]);
  });

  it("legacy claims: pending and paid-0 are different evidence — all four null/0 combos", () => {
    // Frozen paid x live paid, on the ONLY same-code, same-flag line, no stored
    // id, pre-cutoff. Equal kinds match (and arm); mixed kinds never arm.
    const grid: [number | null, number | null, boolean][] = [
      [null, null, true], // pending claimed line still pending: matches itself
      [0, 0, true],
      [0, null, false], // the reproducer: a pending twin is not "paid 0"
      [null, 0, false], // and a paid-0 line is not a pending claim's line
    ];
    for (const [frozen, live, arms] of grid) {
      const d = dispute({
        status: "resolved",
        claimedHours: 0.3,
        recoveredHours: 0.3,
        createdAt: BEFORE,
        lines: [line({ entryId: "e1", code: "A", flaggedHours: 0.3, paidHours: frozen, claimedHours: 0.3 })],
      });
      const plan = pendingRecoveryApplication(d, [ro([A("X", live)])], []);
      const tag = `frozen ${frozen} / live ${live}`;
      expect(plan.rows.map((r) => [r.lineId, r.paidAfter]), tag).toEqual(arms ? [["X", 0.3]] : []);
      expect(plan.unmappedHours, tag).toBe(arms ? 0 : 0.3);
      // Never reported as moved either: nothing landed on it.
      expect(plan.moved, tag).toEqual([]);
    }
  });

  it("legacy claims, property: a deleted claimed line never hands its recovery to a same-flag twin of the other paid kind", () => {
    for (const flag of [0.3, 1, 2.5])
      for (const rec of [0.1, flag / 2, flag])
        for (const [claimedPaid, twinPaid] of [[0, null], [null, 0]] as [number | null, number | null][]) {
          const d = dispute({
            status: "resolved",
            claimedHours: rec,
            recoveredHours: rec,
            createdAt: BEFORE,
            lines: [line({ entryId: "e1", code: "A", flaggedHours: flag, paidHours: claimedPaid, claimedHours: flag - (claimedPaid ?? 0) })],
          });
          const twin = roLine({ id: "T", customCode: "A", flagHours: flag, paidHours: twinPaid });
          const plan = pendingRecoveryApplication(d, [ro([twin])], []);
          expect(plan.rows, `${flag}/${rec}/${claimedPaid}/${twinPaid}`).toEqual([]);
        }
  });
});
