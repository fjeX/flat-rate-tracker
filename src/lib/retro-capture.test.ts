import { describe, it, expect } from "vitest";
import {
  lightAskHref,
  lightRetroForLine,
  lightRetroCandidate,
  lightRetroChips,
  retroBuckets,
  retroCandidates,
  retroStep,
} from "./retro-capture";
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

describe("lightRetroCandidate", () => {
  const on = { optedIn: true };

  it("asks about a 1.5h line for an opted-in tech", () => {
    const out = lightRetroCandidate(entry([line({ flagHours: 1.5, customCode: "ALIGN" })]), [], on);
    expect(out?.code).toBe("ALIGN");
    expect(out?.lineId).toBe("l1");
  });

  it("never asks a tech who has not opted in", () => {
    expect(
      lightRetroCandidate(entry([line({ flagHours: 1.5 })]), [], { optedIn: false }),
    ).toBeNull();
  });

  it("band edges: 0.99 no, 1.0 yes, 1.99 yes, 2.0 no (that one is the modal's)", () => {
    const at = (h: number) => lightRetroCandidate(entry([line({ flagHours: h })]), [], on);
    expect(at(0.99)).toBeNull();
    expect(at(1.0)).not.toBeNull();
    expect(at(1.99)).not.toBeNull();
    expect(at(2.0)).toBeNull();
  });

  it("excludes comebacks and lines the timer already measured", () => {
    expect(
      lightRetroCandidate(entry([line({ flagHours: 1.5, isComeback: true })]), [], on),
    ).toBeNull();
    expect(
      lightRetroCandidate(entry([line({ flagHours: 1.5, actualHours: 1.2 })]), [], on),
    ).toBeNull();
  });

  it("returns null when any 2h+ candidate exists: one ask per save", () => {
    expect(
      lightRetroCandidate(
        entry([line({ id: "a", flagHours: 1.5 }), line({ id: "b", flagHours: 2.5 })]),
        [],
        on,
      ),
    ).toBeNull();
  });

  it("an already-timed 2h+ line does not block the light ask", () => {
    // retroCandidates skips it (nothing to ask), so the modal will not fire.
    const out = lightRetroCandidate(
      entry([line({ id: "a", flagHours: 1.5 }), line({ id: "b", flagHours: 4, actualHours: 3.5 })]),
      [],
      on,
    );
    expect(out?.lineId).toBe("a");
  });

  it("picks the biggest flag, ties to the earlier line", () => {
    const out = lightRetroCandidate(
      entry([
        line({ id: "a", flagHours: 1.2 }),
        line({ id: "b", flagHours: 1.8 }),
        line({ id: "c", flagHours: 1.8 }),
      ]),
      [],
      on,
    );
    expect(out?.lineId).toBe("b");
  });
});

describe("lightRetroChips", () => {
  it("never offers more than 6 chips, across the whole band", () => {
    for (let h = 1; h < 2; h = Math.round((h + 0.01) * 100) / 100) {
      const chips = lightRetroChips(h);
      expect(chips.length).toBeGreaterThanOrEqual(3);
      expect(chips.length).toBeLessThanOrEqual(6);
    }
  });

  it("uses 15-minute steps for a 1h job and spans about 0.5x to 1.5x", () => {
    const chips = lightRetroChips(1);
    expect(chips.map((c) => c.hours)).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
    expect(chips.map((c) => c.label)).toEqual(["0.5h", "0.75h", "1h", "1.25h", "1.5h+"]);
  });

  it("falls back to 30-minute steps near 2h instead of dropping an end", () => {
    const chips = lightRetroChips(1.99);
    expect(chips.map((c) => c.hours)).toEqual([1, 1.5, 2, 2.5, 3]);
  });

  it("is plain clock hours: ascending, positive, book not marked, top is the lower bound", () => {
    for (const book of [1, 1.25, 1.5, 1.75, 1.99]) {
      const chips = lightRetroChips(book);
      const hours = chips.map((c) => c.hours);
      expect(hours.every((h) => h > 0 && h < 4)).toBe(true);
      expect([...hours].sort((a, b) => a - b)).toEqual(hours);
      expect(new Set(hours).size).toBe(hours.length);
      expect(chips.some((c) => /book/i.test(c.label))).toBe(false);
      expect(chips.slice(0, -1).every((c) => !c.label.endsWith("+"))).toBe(true);
      expect(chips[chips.length - 1].label.endsWith("h+")).toBe(true);
    }
  });
});

describe("lightAskHref / lightRetroForLine (dashboard variant)", () => {
  const on = { optedIn: true };

  it("builds /dashboard?ask=<lineId> and leaves other targets alone", () => {
    expect(lightAskHref("/dashboard", "abc")).toBe("/dashboard?ask=abc");
    expect(lightAskHref("/timer", "abc")).toBe("/timer");
    expect(lightAskHref("/guest", "abc")).toBe("/guest");
  });

  it("resolves a named eligible line, with the same eligibility as the save-time rule", () => {
    const e = entry([line({ id: "a", flagHours: 1.5 }), line({ id: "b", flagHours: 1.2 })]);
    expect(lightRetroForLine(e, "b", [], on)?.lineId).toBe("b");
    expect(lightRetroForLine(e, "zzz", [], on)).toBeNull();
    expect(lightRetroForLine(e, "a", [], { optedIn: false })).toBeNull();
  });

  it("band edges, timed and comeback lines all resolve to null", () => {
    const at = (over: Partial<EntryOpCode>) =>
      lightRetroForLine(entry([line({ id: "a", ...over })]), "a", [], on);
    expect(at({ flagHours: 0.99 })).toBeNull();
    expect(at({ flagHours: 1 })).not.toBeNull();
    expect(at({ flagHours: 1.99 })).not.toBeNull();
    expect(at({ flagHours: 2 })).toBeNull();
    expect(at({ flagHours: 1.5, actualHours: 1 })).toBeNull();
    expect(at({ flagHours: 1.5, isComeback: true })).toBeNull();
  });
});
