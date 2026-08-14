import { describe, it, expect } from "vitest";
import {
  buildDisputePack,
  formatDisputePackText,
  type BuildDisputePackInput,
} from "./dispute-pack";
import { ratesToMap } from "./earnings";
import { reconcileEntries } from "./reconcile";
import type {
  Entry,
  EntryOpCode,
  LaborType,
  OpCode,
  UnpaidTime,
} from "./types";

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
    id: over.id ?? "e",
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date: "2026-07-01",
    roNumber: over.roNumber ?? "1001",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
    ...over,
  };
}

const rateOf = (type: LaborType, hourlyRate: number) => ({
  laborType: type,
  hourlyRate,
});

// A tiny library with one op code that has a sub-op-code variant.
const library: OpCode[] = [
  {
    id: "oc1",
    userId: "u",
    code: "B12",
    description: "Brake job",
    flagHours: 2,
    notes: "",
    tags: [],
    sortOrder: 0,
    createdAt: "",
    subOpCodes: [
      {
        id: "sub1",
        opCodeId: "oc1",
        userId: "u",
        code: "R",
        description: "Rear",
        flagHours: 1,
        sortOrder: 0,
        createdAt: "",
      },
    ],
  },
];

function build(over: Partial<BuildDisputePackInput> = {}) {
  return buildDisputePack({
    entries: [],
    periodLabel: "Jul 1 – Jul 15",
    library,
    ...over,
  });
}

describe("buildDisputePack — line selection", () => {
  it("includes only short lines by default; drops paid/over/pending", () => {
    const entries = [
      entry(
        [
          line({ id: "a", flagHours: 2, paidHours: null }), // pending → dropped
          line({ id: "b", flagHours: 2, paidHours: 2 }), // paid → dropped
          line({ id: "c", flagHours: 3, paidHours: 1 }), // short → kept
          line({ id: "d", flagHours: 1, paidHours: 3 }), // over → dropped
        ],
        { id: "e1", roNumber: "1001" },
      ),
    ];
    const pack = build({ entries });
    expect(pack.lines.map((l) => l.status)).toEqual(["short"]);
    expect(pack.lines[0].flagged).toBe(3);
    expect(pack.lines[0].paid).toBe(1);
    expect(pack.lines[0].deltaHours).toBeCloseTo(2, 5);
  });

  it("zero-short period produces an empty pack", () => {
    const entries = [entry([line({ flagHours: 2, paidHours: 2 })])];
    const pack = build({ entries });
    expect(pack.lines).toHaveLength(0);
    expect(pack.totalShortHours).toBe(0);
    expect(pack.disputedRoCount).toBe(0);
  });
});

describe("buildDisputePack — includePending toggle", () => {
  it("includes pending lines only when the period has ended", () => {
    const entries = [
      entry([line({ id: "p", flagHours: 4, paidHours: null })], {
        roNumber: "2002",
      }),
    ];
    // Period not yet ended → pending excluded even with the toggle on.
    const mid = build({
      entries,
      includePending: true,
      periodEnd: "2026-07-15",
      today: "2026-07-10",
    });
    expect(mid.lines).toHaveLength(0);

    // Period ended → pending now counts, with the full flag outstanding.
    const after = build({
      entries,
      includePending: true,
      periodEnd: "2026-07-15",
      today: "2026-07-16",
    });
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0].status).toBe("pending");
    expect(after.lines[0].paid).toBeNull();
    expect(after.lines[0].deltaHours).toBe(4);
    expect(after.totalShortHours).toBe(4);
  });
});

describe("buildDisputePack — code/description resolution", () => {
  it("labels custom lines with their custom code and null-safe description", () => {
    const entries = [
      entry([
        line({
          id: "cx",
          custom: true,
          customCode: "SPECIAL-1",
          customDescription: null, // null join must not throw
          flagHours: 2,
          paidHours: 0.5,
        }),
      ]),
    ];
    const pack = build({ entries });
    expect(pack.lines[0].code).toBe("SPECIAL-1");
    expect(pack.lines[0].description).toBe("");
  });

  it("resolves a library op code and its sub-op-code variant", () => {
    const entries = [
      entry([
        line({
          id: "s",
          opCodeId: "oc1",
          subOpCodeId: "sub1",
          flagHours: 2,
          paidHours: 1,
        }),
      ]),
    ];
    const pack = build({ entries });
    expect(pack.lines[0].code).toBe("B12 · R");
    expect(pack.lines[0].description).toBe("Rear");
  });
});

describe("buildDisputePack — dollars", () => {
  it("prices each short line by its own labor-type rate when rates exist", () => {
    const rates = ratesToMap([
      rateOf("customer_pay", 30),
      rateOf("warranty", 20),
    ]);
    const entries = [
      entry([
        // untyped → customer_pay; short by 1h → $30
        line({ id: "a", flagHours: 2, paidHours: 1, laborType: null }),
        // warranty short by 2h → $40
        line({ id: "b", flagHours: 3, paidHours: 1, laborType: "warranty" }),
      ]),
    ];
    const pack = build({ entries, rates });
    expect(pack.hasRates).toBe(true);
    expect(pack.lines[0].deltaDollars).toBeCloseTo(30, 5);
    expect(pack.lines[1].deltaDollars).toBeCloseTo(40, 5);
    expect(pack.totalShortDollars).toBeCloseTo(70, 5);
  });

  it("degrades to hours-only when no rates are priced", () => {
    const entries = [entry([line({ flagHours: 2, paidHours: 0 })])];
    const pack = build({ entries, rates: {} });
    expect(pack.hasRates).toBe(false);
    expect(pack.totalShortDollars).toBeNull();
    expect(pack.lines[0].deltaDollars).toBeNull();
  });

  it("short line of an unpriced type gets null dollars but still counts hours", () => {
    const rates = ratesToMap([rateOf("warranty", 20)]); // customer_pay unpriced
    const entries = [
      entry([line({ flagHours: 2, paidHours: 0, laborType: "customer_pay" })]),
    ];
    const pack = build({ entries, rates });
    expect(pack.hasRates).toBe(true);
    expect(pack.lines[0].deltaDollars).toBeNull();
    expect(pack.totalShortHours).toBe(2);
    expect(pack.totalShortDollars).toBe(0); // unpriced line contributes 0
  });
});

describe("buildDisputePack — photo evidence + RO count", () => {
  it("counts distinct disputed ROs and those with a photo record", () => {
    const entries = [
      entry([line({ id: "a", flagHours: 2, paidHours: 1 })], {
        id: "e1",
        roNumber: "1001",
      }),
      entry([line({ id: "b", flagHours: 3, paidHours: 1 })], {
        id: "e2",
        roNumber: "1002",
      }),
    ];
    const pack = build({
      entries,
      entryIdsWithPhotos: new Set(["e1"]), // only e1 has a photo
    });
    expect(pack.disputedRoCount).toBe(2);
    expect(pack.photosAvailable).toBe(1);
  });
});

describe("formatDisputePackText", () => {
  it("renders a professional, emoji-free block with header, lines, totals", () => {
    const rates = ratesToMap([rateOf("customer_pay", 30)]);
    const entries = [
      entry([line({ id: "a", flagHours: 3, paidHours: 1 })], {
        id: "e1",
        roNumber: "1001",
      }),
    ];
    const pack = build({
      entries,
      rates,
      techName: "Jane Tech",
      generatedDate: "Jul 16, 2026",
      entryIdsWithPhotos: new Set(["e1"]),
    });
    const text = formatDisputePackText(pack);
    expect(text).toContain("Flagged vs. Paid Variance Report");
    expect(text).toContain("Technician: Jane Tech");
    expect(text).toContain("RO #1001");
    expect(text).toContain("Total variance: 2.00h");
    expect(text).toContain("$60");
    expect(text).toContain("Photo record available for 1 of 1");
    // No accusatory language / emoji.
    expect(text).not.toMatch(/shorted me|you owe|cheated/i);
    expect(text).not.toMatch(/\p{Emoji_Presentation}/u);
  });

  it("renders an empty-state message for a zero-short pack", () => {
    const pack = build({ entries: [] });
    const text = formatDisputePackText(pack);
    expect(text).toContain("No flagged-vs-paid variances");
  });
});

// ── Unpaid rework section ────────────────────────────────────────────────────

function ledgerRow(over: Partial<UnpaidTime> = {}): UnpaidTime {
  return {
    id: "u1",
    userId: "u",
    date: "2026-07-03",
    hours: 2,
    kind: "wait_parts",
    entryId: null,
    originalEntryId: null,
    source: "manual",
    note: "",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("buildDisputePack — unpaid rework section", () => {
  it("is null when the period has no unpaid time", () => {
    const pack = build({
      entries: [entry([line({ flagHours: 3, paidHours: 1 })])],
    });
    expect(pack.unpaidRework).toBeNull();
  });

  it("collects comeback lines and ledger rows without touching the variance total", () => {
    const entries = [
      entry([line({ id: "a", flagHours: 3, paidHours: 1 })], { id: "e1" }),
      entry(
        [line({ id: "b", flagHours: 0, actualHours: 2.5, isComeback: true })],
        { id: "e2", roNumber: "1002", comebackKind: "comeback_own" },
      ),
    ];
    const pack = build({
      entries,
      unpaid: [ledgerRow({ hours: 1.5 })],
    });
    // The variance report is unchanged: only the short line, only its 2h.
    expect(pack.lines).toHaveLength(1);
    expect(pack.totalShortHours).toBe(2);
    // The unpaid section is separate and totals on its own.
    expect(pack.unpaidRework).not.toBeNull();
    expect(pack.unpaidRework!.comebackHours).toBe(2.5);
    expect(pack.unpaidRework!.waitingHours).toBe(1.5);
    expect(pack.unpaidRework!.totalHours).toBe(4);
  });

  it("renders the section in the text export, below the variance report", () => {
    const entries = [
      entry([line({ id: "a", flagHours: 3, paidHours: 1 })], { id: "e1" }),
      entry(
        [line({ id: "b", flagHours: 0, actualHours: 2, isComeback: true })],
        { id: "e2", roNumber: "1002", comebackKind: "comeback_own" },
      ),
    ];
    const text = formatDisputePackText(build({ entries }));
    expect(text).toContain("Unpaid rework performed");
    expect(text).toContain("Total unpaid time: 2.00h");
    expect(text.indexOf("Total variance")).toBeLessThan(
      text.indexOf("Unpaid rework performed"),
    );
    expect(text).not.toMatch(/\p{Emoji_Presentation}/u);
  });

  it("still reports unpaid rework when there is no variance at all", () => {
    const entries = [
      entry(
        [line({ id: "b", flagHours: 0, actualHours: 2, isComeback: true })],
        { id: "e2", roNumber: "1002", comebackKind: "comeback_own" },
      ),
    ];
    const text = formatDisputePackText(build({ entries }));
    expect(text).toContain("No flagged-vs-paid variances");
    expect(text).toContain("Unpaid rework performed");
  });

  it("says how many hours carry no rate rather than under-totalling silently", () => {
    const entries = [
      entry(
        [
          line({
            id: "b",
            flagHours: 0,
            actualHours: 2,
            isComeback: true,
            laborType: "customer_pay",
          }),
        ],
        { id: "e2", roNumber: "1002", comebackKind: "comeback_own" },
      ),
    ];
    const pack = build({
      entries,
      rates: ratesToMap([rateOf("customer_pay", 30)]),
      unpaid: [ledgerRow({ hours: 4 })],
    });
    expect(pack.unpaidRework!.totalDollars).toBe(60); // the RO line only
    expect(pack.unpaidRework!.unpricedHours).toBe(4);
    const text = formatDisputePackText(pack);
    expect(text).toContain("4.00h of the above carries no rate on file");
  });
});

// The claim a tech freezes has to be the claim the page showed them. These two
// numbers drifted apart in production: Reconciliation reported a 21.2h shortfall
// while the frozen dispute recorded 80.7h, because the pack was built with
// pending lines swept in and Reconciliation counts only genuine shorts.
describe("claim scope agrees with reconciliation", () => {
  const entries = [
    entry(
      [
        line({ id: "a", flagHours: 5, paidHours: null }), // never marked
        line({ id: "b", flagHours: 4, paidHours: null }), // never marked
        line({ id: "c", flagHours: 3, paidHours: 1 }), // short by 2
      ],
      { date: "2026-07-05" },
    ),
  ];
  const dates = { periodEnd: "2026-07-15", today: "2026-07-20" };

  it("excludes never-marked lines by default, matching shortedHours", () => {
    const pack = buildDisputePack({ entries, periodLabel: "Jul", ...dates });
    expect(pack.totalShortHours).toBeCloseTo(
      reconcileEntries(entries).shortedHours,
      5,
    );
    expect(pack.lines).toHaveLength(1);
  });

  it("adds exactly pendingHours when the tech opts in", () => {
    const summary = reconcileEntries(entries);
    const pack = buildDisputePack({
      entries,
      periodLabel: "Jul",
      includePending: true,
      ...dates,
    });
    expect(pack.totalShortHours).toBeCloseTo(
      summary.shortedHours + summary.pendingHours,
      5,
    );
    expect(pack.lines).toHaveLength(3);
  });

  it("still refuses pending lines mid-period even when opted in", () => {
    const pack = buildDisputePack({
      entries,
      periodLabel: "Jul",
      includePending: true,
      periodEnd: "2026-07-15",
      today: "2026-07-10",
    });
    expect(pack.totalShortHours).toBeCloseTo(2, 5);
  });
});
