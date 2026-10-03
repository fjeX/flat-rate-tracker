import { describe, expect, it } from "vitest";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import { entryMatchesSearch } from "./history-search";

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
