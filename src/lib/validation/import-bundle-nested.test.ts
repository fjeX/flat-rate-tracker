// import-nested-shape-crashes-masked (2026-10-01).
//
// importBundleSchema used to check only the top-level rows. A file whose
// NESTED lists (dispute lines, op-code variants, RO lines) or loosely typed
// keys (confirmedZeroDays, shiftOverrides, roEvents) had the wrong shape passed
// the schema and then died as a TypeError inside buildImportPayload — which
// importDataAction does not convert, so the tech saw the masked production
// error. Each case below proves BOTH halves: the builder really does crash (or
// build junk) on that shape, and the schema now refuses it with a sentence.
//
// The second half guards the other direction: every app-made file of every
// supported version must still pass, because the schema promises nothing new
// is required.
import { describe, expect, it } from "vitest";
import { check } from "./core";
import { importBundleSchema } from "./actions";
import { buildBackupBundle, type BackupParts } from "@/lib/backup-bundle";
import { buildImportPayload, type ImportBundle } from "@/lib/import-remap";

type Row = Record<string, unknown>;
const ts = "2026-01-01T00:00:00Z";

function parts(): BackupParts {
  return {
    settings: {
      userId: "U1",
      splitDay: 15,
      goalHours: 88,
      periodOverrides: {},
      updatedAt: ts,
      roTemplates: [],
      defaultLaborType: null,
      referenceHourlyRate: null,
      tagColors: {},
      shareLaborTimes: true,
      trackRoTime: false,
      theme: "light",
      accent: "red",
    } as unknown as BackupParts["settings"],
    entries: [
      {
        id: "E1",
        date: "2026-01-01",
        roNumber: "12345",
        flagHours: 1,
        status: "open",
        opCodes: [
          { id: "L1", opCodeId: "O1", subOpCodeId: "V1", flagHours: 1, actualHours: null, position: 0 },
        ],
        createdAt: ts,
        updatedAt: ts,
      },
    ] as unknown as BackupParts["entries"],
    opCodes: [
      {
        id: "O1",
        code: "LOF",
        flagHours: 1,
        sortOrder: 0,
        createdAt: ts,
        subOpCodes: [
          { id: "V1", opCodeId: "O1", code: "LOF-SYN", flagHours: 1, sortOrder: 0, createdAt: ts },
        ],
      },
    ] as unknown as BackupParts["opCodes"],
    dailyClocks: [{ date: "2026-01-01", hours: 8 }] as unknown as BackupParts["dailyClocks"],
    paidPeriods: [
      { periodKey: "2026-01-P1", paidFlagHours: 40 },
    ] as unknown as BackupParts["paidPeriods"],
    entryPhotos: [{ id: "PH1", path: "u/1.jpg" }],
    bonuses: [{ id: "B1", date: "2026-01-01", amount: 25 }] as unknown as BackupParts["bonuses"],
    laborRates: [
      { id: "R1", laborType: "customer_pay", hourlyRate: 32 },
    ] as unknown as BackupParts["laborRates"],
    disputes: [
      {
        id: "D1",
        periodKey: "2026-01-P1",
        claimedHours: 1,
        lines: [
          { id: "DL1", entryId: "E1", lineId: "L1", code: "LOF", claimedHours: 1, position: 0 },
        ],
        createdAt: ts,
        updatedAt: ts,
      },
    ] as unknown as BackupParts["disputes"],
    unpaidTime: [
      { id: "U1", date: "2026-01-01", hours: 1, source: "manual" },
    ] as unknown as BackupParts["unpaidTime"],
    workSchedules: [
      { id: "S1", effectiveFrom: "2026-01-01", rotationWeeks: 1, anchorMonday: "2025-12-29", weeks: [] },
    ] as unknown as BackupParts["workSchedules"],
    daysOff: [
      { id: "DO1", startDate: "2026-02-01", endDate: "2026-02-07", createdAt: ts },
    ] as unknown as BackupParts["daysOff"],
    shiftOverrides: { "2026-01-05": { start: "08:00", end: "17:00", breakMin: 60 } },
    confirmedZeroDays: ["2026-01-06"],
    portfolioSnapshots: [
      { id: "P1", seq: 1, roThreshold: 100, stats: {}, createdAt: ts },
    ] as unknown as BackupParts["portfolioSnapshots"],
    careerMilestones: [
      { threshold: 100, achievedAt: ts },
    ] as unknown as BackupParts["careerMilestones"],
    roEvents: [
      {
        id: "EV1",
        userId: "U1",
        entryId: "E1",
        date: "2026-01-01",
        time: null,
        kind: "opened",
        note: "",
        createdAt: ts,
        updatedAt: ts,
      },
    ] as unknown as BackupParts["roEvents"],
  };
}

/** What the app exports today, round-tripped through JSON like a real file. */
const v5 = () => JSON.parse(JSON.stringify(buildBackupBundle(parts(), ts))) as Row;

/** A v4 file: the v5 export minus ticket timelines and entries.status. */
function v4(): Row {
  const b = v5();
  b.version = 4;
  delete b.roEvents;
  for (const e of b.entries as Row[]) delete e.status;
  return b;
}

/** A genuine pre-spiff v1 file: the four original sections and nothing else. */
function v1(): Row {
  const b = v5();
  return {
    version: 1,
    exportedAt: b.exportedAt,
    settings: { splitDay: 15, periodOverrides: {} },
    entries: b.entries,
    opCodes: b.opCodes,
    dailyClocks: b.dailyClocks,
    paidPeriods: b.paidPeriods,
  };
}

function build(b: Row) {
  let n = 0;
  return buildImportPayload(b as unknown as ImportBundle, { newId: () => `id-${n++}`, now: ts });
}

const entry0 = (b: Row) => (b.entries as Row[])[0];
const opCode0 = (b: Row) => (b.opCodes as Row[])[0];
const dispute0 = (b: Row) => (b.disputes as Row[])[0];

describe("app-made files of every version still pass", () => {
  it.each<[string, () => Row]>([
    ["v5", v5],
    ["v4", v4],
    ["v1", v1],
  ])("a %s bundle passes the schema and builds", (_l, make) => {
    const b = make();
    const res = check(importBundleSchema, b);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect(() => build(b)).not.toThrow();
  });

  it("the v5 fixture really carries every nested shape (so the pass is not vacuous)", () => {
    const b = v5();
    expect(entry0(b).opCodes).toHaveLength(1);
    expect(opCode0(b).subOpCodes).toHaveLength(1);
    expect(dispute0(b).lines).toHaveLength(1);
    expect(b.roEvents).toHaveLength(1);
    expect(b.confirmedZeroDays).toEqual(["2026-01-06"]);
    expect(Object.keys(b.shiftOverrides as object)).toEqual(["2026-01-05"]);
  });

  it.each<[string, (b: Row) => void]>([
    ["entries[].opCodes null", (b) => void (entry0(b).opCodes = null)],
    ["entries[].opCodes absent", (b) => void delete entry0(b).opCodes],
    ["opCodes[].subOpCodes null", (b) => void (opCode0(b).subOpCodes = null)],
    ["disputes[].lines null", (b) => void (dispute0(b).lines = null)],
  ])("%s is still accepted (the builder reads it through ?? [])", (_l, mutate) => {
    const b = v5();
    mutate(b);
    expect(check(importBundleSchema, b).ok).toBe(true);
    expect(() => build(b)).not.toThrow();
  });
});

describe("malformed nested shapes are refused with a sentence, not a crash", () => {
  it.each<[string, (b: Row) => void, string | null]>([
    ["disputes[].lines as a string", (b) => void (dispute0(b).lines = "abc"), "A dispute's lines must be a list."],
    ["disputes[].lines holding null", (b) => void (dispute0(b).lines = [null]), "A dispute's lines must be a list of records."],
    ["opCodes[].subOpCodes as a number", (b) => void (opCode0(b).subOpCodes = 5), "An op code's variants must be a list."],
    ["opCodes[].subOpCodes holding null", (b) => void (opCode0(b).subOpCodes = [null]), "An op code's variants must be a list of records."],
    ["entries[].opCodes as a number", (b) => void (entry0(b).opCodes = 5), "An RO's op code lines must be a list."],
    ["entries[].opCodes holding null", (b) => void (entry0(b).opCodes = [null]), "An RO's op code lines must be a list of records."],
    ["confirmedZeroDays as a string", (b) => void (b.confirmedZeroDays = "2026-01-06"), "Confirmed zero days must be a list of dates."],
    ["roEvents as a string", (b) => void (b.roEvents = "abc"), "Ticket timelines must be a list."],
    ["roEvents holding null", (b) => void (b.roEvents = [null]), "Ticket timelines must be a list of records."],
    ["shiftOverrides as a number", (b) => void (b.shiftOverrides = 5), "Shift overrides are malformed."],
    ["shiftOverrides as a string", (b) => void (b.shiftOverrides = "abc"), "Shift overrides are malformed."],
    ["a shift override that isn't a shift", (b) => void (b.shiftOverrides = { "2026-01-05": "late" }), "Shift overrides are malformed."],
    ["a shift override missing its break", (b) => void (b.shiftOverrides = { "2026-01-05": { start: "08:00", end: "17:00" } }), "Shift overrides are malformed."],
  ])("%s", (_l, mutate, sentence) => {
    const b = v5();
    mutate(b);
    const res = check(importBundleSchema, b);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    if (sentence) expect(res.error).toBe(sentence);
    // Whatever the wording, it is a sentence and not a stack trace.
    expect(res.error).toMatch(/\.$/);
    expect(res.error).not.toMatch(/TypeError|is not a function|Cannot read/);
  });

  // Proof that the schema is what stands between these files and a crash.
  it.each<[string, (b: Row) => void]>([
    ["disputes[].lines as a string", (b) => void (dispute0(b).lines = "abc")],
    ["opCodes[].subOpCodes as a number", (b) => void (opCode0(b).subOpCodes = 5)],
    ["entries[].opCodes holding null", (b) => void (entry0(b).opCodes = [null])],
    ["confirmedZeroDays as a string", (b) => void (b.confirmedZeroDays = "x")],
    ["roEvents holding null", (b) => void (b.roEvents = [null])],
  ])("without the schema, %s crashes the builder", (_l, mutate) => {
    const b = v5();
    mutate(b);
    expect(() => build(b)).toThrow(TypeError);
  });

  it("without the schema, shiftOverrides = 'abc' builds junk rows instead of crashing", () => {
    const b = v5();
    b.shiftOverrides = "abc";
    expect(build(b).work_shift_overrides).toHaveLength(3);
  });
});
