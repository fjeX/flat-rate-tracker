import { describe, expect, it } from "vitest";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { entryMatchesSearch, findSearchMatches, matchSnippet } from "./history-search";

const library: OpCode[] = [
  {
    id: "lib-brk",
    userId: "u1",
    code: "BRK01",
    description: "Front brake pads",
    flagHours: 1.2,
    notes: "",
    tags: [],
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    subOpCodes: [],
  },
];
const libraryById = new Map(library.map((oc) => [oc.id, oc]));

function line(over: Partial<EntryOpCode>): EntryOpCode {
  return {
    id: "l1",
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

function entry(opCodes: EntryOpCode[]): Entry {
  return {
    id: "e1",
    userId: "u1",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    date: "2026-10-01",
    roNumber: "48213",
    vehicle: { year: "2019", make: "Toyota", model: "Camry", vin: "", mileage: "" },
    flagHours: 1,
    notes: "customer waiting",
    opCodes,
  };
}

describe("entryMatchesSearch", () => {
  const libLine = entry([line({ opCodeId: "lib-brk" })]);
  const customLine = entry([
    line({ custom: true, customCode: "DIAG-EV", customDescription: "Hybrid battery diag" }),
  ]);

  it("matches everything on an empty or blank query", () => {
    expect(entryMatchesSearch(libLine, "", libraryById)).toBe(true);
    expect(entryMatchesSearch(libLine, "   ", libraryById)).toBe(true);
  });

  it("still matches RO number, vehicle and notes", () => {
    expect(entryMatchesSearch(libLine, "4821", libraryById)).toBe(true);
    expect(entryMatchesSearch(libLine, "camry", libraryById)).toBe(true);
    expect(entryMatchesSearch(libLine, "waiting", libraryById)).toBe(true);
  });

  it("matches a library op code by code and by description, any case", () => {
    expect(entryMatchesSearch(libLine, "brk01", libraryById)).toBe(true);
    expect(entryMatchesSearch(libLine, "Brake Pads", libraryById)).toBe(true);
  });

  it("matches a custom op code by its own code and description", () => {
    expect(entryMatchesSearch(customLine, "diag-ev", libraryById)).toBe(true);
    expect(entryMatchesSearch(customLine, "hybrid", libraryById)).toBe(true);
  });

  it("does not match what is not there", () => {
    expect(entryMatchesSearch(libLine, "alignment", libraryById)).toBe(false);
    expect(entryMatchesSearch(customLine, "brk01", libraryById)).toBe(false);
  });

  it("survives a library line whose op code was deleted", () => {
    const orphan = entry([line({ opCodeId: "gone" })]);
    expect(entryMatchesSearch(orphan, "brk", libraryById)).toBe(false);
    expect(entryMatchesSearch(orphan, "48213", libraryById)).toBe(true);
  });
});

describe("findSearchMatches", () => {
  const libLine = entry([line({ opCodeId: "lib-brk" })]);
  const customLine = entry([
    line({ custom: true, customCode: "DIAG-EV", customDescription: "Hybrid battery diag" }),
  ]);

  it("reports nothing for a blank query", () => {
    expect(findSearchMatches(libLine, "  ", libraryById)).toEqual([]);
  });

  it("reports the RO number hit with its range", () => {
    expect(findSearchMatches(libLine, "821", libraryById)).toEqual([
      { field: "ro", text: "48213", start: 1, end: 4 },
    ]);
  });

  it("reports the vehicle hit, any case", () => {
    const [m] = findSearchMatches(libLine, "CAMRY", libraryById);
    expect(m.field).toBe("vehicle");
    expect(m.text.slice(m.start, m.end)).toBe("Camry");
  });

  it("reports an op code hit in the description of a library line", () => {
    const [m] = findSearchMatches(libLine, "pads", libraryById);
    expect(m.field).toBe("op");
    expect(m.text).toBe("BRK01 Front brake pads");
    expect(m.text.slice(m.start, m.end)).toBe("pads");
  });

  it("reports a custom line hit in its code and in its description", () => {
    expect(findSearchMatches(customLine, "diag-ev", libraryById)[0]).toMatchObject({ field: "op", start: 0, end: 7 });
    const [d] = findSearchMatches(customLine, "battery", libraryById);
    expect(d.text.slice(d.start, d.end)).toBe("battery");
  });

  it("reports a note hit, with whitespace collapsed", () => {
    const e = { ...libLine, notes: "customer\n  waiting in lounge" };
    const [m] = findSearchMatches(e, "waiting", libraryById);
    expect(m.field).toBe("note");
    expect(m.text).toBe("customer waiting in lounge");
    expect(m.text.slice(m.start, m.end)).toBe("waiting");
  });

  it("reports every field that hit, once each, in a fixed order", () => {
    const e = { ...entry([line({ opCodeId: "lib-brk" }), line({ id: "l2", opCodeId: "lib-brk" })]), notes: "brake noise" };
    expect(findSearchMatches(e, "brake", libraryById).map((m) => m.field)).toEqual(["op", "note"]);
  });

  it("agrees with entryMatchesSearch", () => {
    expect(findSearchMatches(libLine, "alignment", libraryById)).toEqual([]);
    expect(entryMatchesSearch(libLine, "alignment", libraryById)).toBe(false);
  });
});

describe("matchSnippet", () => {
  it("windows long text and marks the cuts", () => {
    const text = "a".repeat(40) + "NEEDLE" + "b".repeat(40);
    const s = matchSnippet({ field: "note", text, start: 40, end: 46 }, 10);
    expect(s.hit).toBe("NEEDLE");
    expect(s.before).toBe("…" + "a".repeat(10));
    expect(s.after).toBe("b".repeat(10) + "…");
  });

  it("adds no ellipsis when the text fits", () => {
    const s = matchSnippet({ field: "ro", text: "48213", start: 1, end: 4 });
    expect(s).toEqual({ before: "4", hit: "821", after: "3" });
  });
});
