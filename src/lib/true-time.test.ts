import { describe, it, expect } from "vitest";
import {
  flagToActualRatio,
  isPoolableLine,
  normalizeCode,
  normalizeVehiclePart,
  observationsFromEntry,
  observedMonthFor,
  parseVehicleYear,
} from "./true-time";
import type { Entry, EntryOpCode, OpCode } from "./types";

function line(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: "l1",
    opCodeId: null,
    custom: false,
    customCode: null,
    customDescription: null,
    flagHours: 1.5,
    actualHours: 2,
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
    id: "e1",
    userId: "u1",
    createdAt: "",
    updatedAt: "",
    date: "2026-07-20",
    roNumber: "1001",
    vehicle: { year: "2021", make: "Toyota", model: "RAV4", vin: "", mileage: "" },
    opCodes: lines,
    flagHours: lines.reduce((s, l) => s + l.flagHours, 0),
    notes: "",
    ...over,
  } as Entry;
}

function opCode(over: Partial<OpCode> = {}): OpCode {
  return {
    id: "oc1",
    userId: "u1",
    code: "BRK-F",
    description: "Front brakes",
    flagHours: 1.5,
    sortOrder: 0,
    notes: "",
    tags: [],
    subOpCodes: [],
    ...over,
  } as OpCode;
}

describe("normalizeCode", () => {
  it("folds case and strips punctuation so shop variants pool", () => {
    expect(normalizeCode("BRK-F")).toBe("BRKF");
    expect(normalizeCode("brk f")).toBe("BRKF");
    expect(normalizeCode("brk.f")).toBe("BRKF");
    expect(normalizeCode("  Brk_F  ")).toBe("BRKF");
  });

  it("keeps a sub-op variant distinct from its parent", () => {
    // A sub-variant is a different job; it should not collapse into the parent.
    expect(normalizeCode("LOF · SYN")).toBe("LOFSYN");
    expect(normalizeCode("LOF")).toBe("LOF");
    expect(normalizeCode("LOF · SYN")).not.toBe(normalizeCode("LOF"));
  });

  it("keeps digits", () => {
    expect(normalizeCode("TR4")).toBe("TR4");
  });

  it("reduces a label with no alphanumerics to empty", () => {
    // lineCode() returns an em-dash for a dangling library reference.
    expect(normalizeCode("—")).toBe("");
  });
});

describe("normalizeVehiclePart", () => {
  it("folds case and punctuation", () => {
    expect(normalizeVehiclePart("RAV4")).toBe("RAV4");
    expect(normalizeVehiclePart("rav-4")).toBe("RAV4");
    expect(normalizeVehiclePart("F-150")).toBe("F150");
    expect(normalizeVehiclePart("  Toyota ")).toBe("TOYOTA");
  });

  it("returns empty for blank", () => {
    expect(normalizeVehiclePart("")).toBe("");
    expect(normalizeVehiclePart("   ")).toBe("");
  });
});

describe("parseVehicleYear", () => {
  it("parses a plausible 4-digit year", () => {
    expect(parseVehicleYear("2021")).toBe(2021);
  });

  it("is null for blank", () => {
    expect(parseVehicleYear("")).toBeNull();
    expect(parseVehicleYear("  ")).toBeNull();
  });

  it("rejects typos rather than creating a phantom bucket", () => {
    expect(parseVehicleYear("20211")).toBeNull();
    expect(parseVehicleYear("0")).toBeNull();
    expect(parseVehicleYear("21")).toBeNull();
    expect(parseVehicleYear("abcd")).toBeNull();
    expect(parseVehicleYear("2O21")).toBeNull();
  });

  it("rejects implausible in-format years", () => {
    expect(parseVehicleYear("1899")).toBeNull();
    expect(parseVehicleYear("2101")).toBeNull();
    expect(parseVehicleYear("1900")).toBe(1900);
    expect(parseVehicleYear("2100")).toBe(2100);
  });
});

describe("observedMonthFor", () => {
  it("coarsens a work date to the first of its month", () => {
    expect(observedMonthFor("2026-07-20")).toBe("2026-07-01");
    expect(observedMonthFor("2026-01-31")).toBe("2026-01-01");
  });

  it("is null for a malformed date so the row is dropped, not stored wrong", () => {
    expect(observedMonthFor("")).toBeNull();
    expect(observedMonthFor("2026-7-20")).toBeNull();
    expect(observedMonthFor("07/20/2026")).toBeNull();
    expect(observedMonthFor("2026-13-01")).toBeNull();
    expect(observedMonthFor("2026-00-01")).toBeNull();
  });
});

describe("isPoolableLine", () => {
  it("accepts a timed line with real book time", () => {
    expect(isPoolableLine(line({ flagHours: 1.5, actualHours: 2 }))).toBe(true);
  });

  it("rejects an untimed line — there is no measurement", () => {
    expect(isPoolableLine(line({ actualHours: null }))).toBe(false);
    expect(isPoolableLine(line({ actualHours: 0 }))).toBe(false);
  });

  it("rejects a zero-flag line so comebacks can't poison the ratio", () => {
    // Comebacks flag exactly 0; a 0/actual ratio is meaningless here.
    expect(isPoolableLine(line({ flagHours: 0, actualHours: 3 }))).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isPoolableLine(line({ actualHours: Number.NaN }))).toBe(false);
    expect(isPoolableLine(line({ flagHours: Number.POSITIVE_INFINITY }))).toBe(false);
  });
});

describe("observationsFromEntry", () => {
  it("builds one observation per timed line with normalized keys", () => {
    const oc = opCode();
    const result = observationsFromEntry(
      entry([line({ id: "l1", opCodeId: oc.id, flagHours: 1.5, actualHours: 2.25 })]),
      [oc],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      entryId: "e1",
      lineId: "l1",
      codeNorm: "BRKF",
      makeNorm: "TOYOTA",
      modelNorm: "RAV4",
      vehicleYear: 2021,
      flagHours: 1.5,
      actualHours: 2.25,
      observedMonth: "2026-07-01",
    });
  });

  it("skips untimed lines and keeps timed ones from the same RO", () => {
    const oc = opCode();
    const result = observationsFromEntry(
      entry([
        line({ id: "l1", opCodeId: oc.id, actualHours: null }),
        line({ id: "l2", opCodeId: oc.id, actualHours: 1.1 }),
      ]),
      [oc],
    );
    expect(result.map((o) => o.lineId)).toEqual(["l2"]);
  });

  it("returns [] when nothing on the RO was timed — the normal case", () => {
    const oc = opCode();
    expect(
      observationsFromEntry(
        entry([line({ opCodeId: oc.id, actualHours: null })]),
        [oc],
      ),
    ).toEqual([]);
  });

  it("pools a custom line under its own code", () => {
    const result = observationsFromEntry(
      entry([
        line({
          id: "l9",
          custom: true,
          customCode: "diag-elec",
          actualHours: 3,
          flagHours: 1,
        }),
      ]),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].codeNorm).toBe("DIAGELEC");
  });

  it("drops an unnamed custom line instead of pooling it as CUSTOM", () => {
    // lineCode() falls back to "Custom" — a giant meaningless bucket.
    const result = observationsFromEntry(
      entry([line({ custom: true, customCode: "", actualHours: 3 })]),
      [],
    );
    expect(result).toEqual([]);
  });

  it("drops a line whose library op code was deleted", () => {
    // lineCode() returns an em-dash, which normalizes to "".
    const result = observationsFromEntry(
      entry([line({ opCodeId: "missing-oc", actualHours: 3 })]),
      [],
    );
    expect(result).toEqual([]);
  });

  it("returns [] for a malformed work date", () => {
    const oc = opCode();
    expect(
      observationsFromEntry(
        entry([line({ opCodeId: oc.id })], { date: "not-a-date" }),
        [oc],
      ),
    ).toEqual([]);
  });

  it("still pools at make/model level when the year is missing or junk", () => {
    const oc = opCode();
    const result = observationsFromEntry(
      entry([line({ opCodeId: oc.id })], {
        vehicle: { year: "", make: "Ford", model: "F-150", vin: "", mileage: "" },
      } as Partial<Entry>),
      [oc],
    );
    expect(result[0].vehicleYear).toBeNull();
    expect(result[0].makeNorm).toBe("FORD");
    expect(result[0].modelNorm).toBe("F150");
  });

  it("keys a sub-op line separately from the parent op code", () => {
    const oc = opCode({
      id: "oc2",
      code: "LOF",
      subOpCodes: [
        { id: "s1", code: "SYN", description: "Synthetic", flagHours: 0.4 },
      ],
    } as Partial<OpCode>);
    const parent = observationsFromEntry(
      entry([line({ id: "lp", opCodeId: "oc2" })], { id: "ep" }),
      [oc],
    );
    const sub = observationsFromEntry(
      entry([line({ id: "ls", opCodeId: "oc2", subOpCodeId: "s1" })], { id: "es" }),
      [oc],
    );
    expect(parent[0].codeNorm).toBe("LOF");
    expect(sub[0].codeNorm).toBe("LOFSYN");
    expect(parent[0].codeNorm).not.toBe(sub[0].codeNorm);
  });

  it("pools identically-named codes across differing punctuation and case", () => {
    const a = opCode({ id: "a", code: "BRK-F" });
    const b = opCode({ id: "b", code: "brk f" });
    const one = observationsFromEntry(
      entry([line({ opCodeId: "a" })], { id: "e-a" }),
      [a],
    );
    const two = observationsFromEntry(
      entry([line({ opCodeId: "b" })], { id: "e-b" }),
      [b],
    );
    expect(one[0].codeNorm).toBe(two[0].codeNorm);
  });
});

describe("flagToActualRatio", () => {
  it("is below 1 when the job took longer than book", () => {
    const r = flagToActualRatio({ flagHours: 3, actualHours: 5 });
    expect(r).toBeCloseTo(0.6);
  });

  it("is above 1 when you beat book", () => {
    const r = flagToActualRatio({ flagHours: 3, actualHours: 1.5 });
    expect(r).toBe(2);
  });

  it("is 1 when it landed exactly on book", () => {
    expect(flagToActualRatio({ flagHours: 2, actualHours: 2 })).toBe(1);
  });

  it("is null when there is no measured actual", () => {
    expect(flagToActualRatio({ flagHours: 2, actualHours: 0 })).toBeNull();
    expect(flagToActualRatio({ flagHours: 2, actualHours: Number.NaN })).toBeNull();
  });
});
