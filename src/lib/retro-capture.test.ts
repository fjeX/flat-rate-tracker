import { describe, it, expect } from "vitest";
import { retroBuckets, retroCandidates, retroStep } from "./retro-capture";
import { HEAVY_FLAG_HOURS } from "./mix";
import type { Entry, EntryOpCode, OpCode } from "./types";

function line(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: over.id ?? "l1",
    opCodeId: null,
    custom: true,
    customCode: "WP",
    customDescription: "Water pump",
    flagHours: 5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    paidHours: null,
    ...over,
  };
}

function entry(lines: EntryOpCode[]): Entry {
  return {
    id: "e1",
    userId: "u",
    createdAt: "",
    updatedAt: "",
    date: "2026-08-13",
    roNumber: "12345",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
  };
}

describe("retroCandidates", () => {
  it("asks about a big job", () => {
    const out = retroCandidates(entry([line({ flagHours: 5 })]));
    expect(out).toHaveLength(1);
    expect(out[0].flagHours).toBe(5);
    expect(out[0].code).toBe("WP");
  });

  it("never asks about the maintenance grind", () => {
    // The whole reason this feature exists instead of a louder timer nag.
    const out = retroCandidates(
      entry([
        line({ id: "a", flagHours: 0.3, customCode: "LOF" }),
        line({ id: "b", flagHours: 0.7, customCode: "10KB" }),
        line({ id: "c", flagHours: 1.5, customCode: "ALIGN" }),
      ]),
    );
    expect(out).toHaveLength(0);
  });

  it("includes a line exactly on the threshold", () => {
    expect(retroCandidates(entry([line({ flagHours: HEAVY_FLAG_HOURS })]))).toHaveLength(1);
    expect(
      retroCandidates(entry([line({ flagHours: HEAVY_FLAG_HOURS - 0.01 })])),
    ).toHaveLength(0);
  });

  it("does not re-ask about a job the timer already measured", () => {
    // Letting a memory overwrite a clock reading would be a downgrade the tech
    // never asked for.
    expect(
      retroCandidates(entry([line({ flagHours: 8, actualHours: 6.25 })])),
    ).toHaveLength(0);
  });

  it("skips comebacks", () => {
    expect(
      retroCandidates(entry([line({ flagHours: 0, isComeback: true })])),
    ).toHaveLength(0);
  });

  it("labels a library line through the shared labeller", () => {
    const library: OpCode[] = [
      {
        id: "oc1",
        userId: "u",
        code: "TB",
        description: "Timing belt",
        flagHours: 6,
        sortOrder: 0,
        createdAt: "",
        notes: "",
        tags: [],
        subOpCodes: [],
      } as unknown as OpCode,
    ];
    const out = retroCandidates(
      entry([line({ custom: false, opCodeId: "oc1", flagHours: 6 })]),
      library,
    );
    expect(out[0].code).toBe("TB");
    expect(out[0].description).toBe("Timing belt");
  });

  it("returns every big line on a multi-line ticket", () => {
    const out = retroCandidates(
      entry([
        line({ id: "a", flagHours: 5 }),
        line({ id: "b", flagHours: 0.3 }),
        line({ id: "c", flagHours: 3 }),
      ]),
    );
    expect(out.map((c) => c.lineId)).toEqual(["a", "c"]);
  });
});

describe("retroStep", () => {
  it("keeps resolution proportional to the job", () => {
    expect(retroStep(2.5)).toBe(0.5);
    expect(retroStep(5)).toBe(1);
    expect(retroStep(10)).toBe(2);
    expect(retroStep(20)).toBe(4);
  });
});

describe("retroBuckets", () => {
  it("offers a tappable number of chips on a phone", () => {
    for (const flag of [2, 3, 5, 8, 14, 25]) {
      const b = retroBuckets(flag);
      expect(b.length).toBeGreaterThanOrEqual(3);
      expect(b.length).toBeLessThanOrEqual(7);
    }
  });

  it("climbs and never repeats a stored value", () => {
    for (const flag of [2, 3, 5, 8, 14, 25]) {
      const b = retroBuckets(flag);
      const hours = b.map((x) => x.hours);
      expect(new Set(hours).size).toBe(hours.length);
      for (let i = 1; i < hours.length; i++) {
        expect(hours[i]).toBeGreaterThan(hours[i - 1]);
      }
    }
  });

  it("lets a tech record genuinely beating the book", () => {
    // A 5h water pump done in 1.5h is the reading this whole feature is for. If
    // the ladder cannot express it, the feature is pointless.
    const b = retroBuckets(5);
    expect(b.some((x) => x.hours <= 1.5)).toBe(true);
  });

  it("reaches past the book time so an overrun is expressible", () => {
    for (const flag of [2, 5, 8]) {
      const b = retroBuckets(flag);
      expect(b[b.length - 1].hours).toBeGreaterThan(flag);
    }
  });

  it("marks only the last chip open-ended", () => {
    const b = retroBuckets(5);
    expect(b[b.length - 1].label.endsWith("+")).toBe(true);
    expect(b.slice(0, -1).every((x) => !x.label.endsWith("+"))).toBe(true);
  });

  it("does not print a trailing .0", () => {
    expect(retroBuckets(5).map((b) => b.label)).not.toContain("1.0h");
  });

  it("never labels two chips the same thing", () => {
    for (const flag of [2, 3, 5, 8, 14, 25]) {
      const labels = retroBuckets(flag).map((x) => x.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("does not anchor on the book time", () => {
    // No chip announces itself as the book value. A tech unsure of the answer
    // must not be handed the one number that makes the reading worthless.
    for (const flag of [2, 5, 8]) {
      for (const b of retroBuckets(flag)) {
        expect(b.label.toLowerCase()).not.toContain("book");
        expect(b.label.toLowerCase()).not.toContain("flag");
      }
    }
  });
});
