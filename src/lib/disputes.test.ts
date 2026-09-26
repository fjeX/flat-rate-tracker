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
  pendingRecoveryApplication,
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
  // this line under either reading, so the recovery is still owed.
  it("still offers when a line pending at claim time was later reconciled at zero", () => {
    const d = dispute({
      status: "resolved",
      recoveredHours: 1.5,
      lines: [
        line({ entryId: "e1", paidHours: null, claimedHours: 1.5, recoveredHours: 1.5 }),
      ],
    });
    const plan = pendingRecoveryApplication(d, [ro([roLine({ paidHours: 0 })])], []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].paidAfter).toBeCloseTo(1.5, 5);
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
    const d = dispute({
      status: "resolved",
      recoveredHours: 1.5,
      lines: [
        line({
          entryId: "e1",
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
