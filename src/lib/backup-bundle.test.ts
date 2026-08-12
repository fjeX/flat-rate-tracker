// Binds BACKUP_MANIFEST to the EXPORT end of backup/import.
//
// backup-manifest.test.ts already proves the manifest matches what
// buildImportPayload writes. That is the import end, and it is not the end that
// broke: the six tables missing from every backup before 2026-08-12 were absent
// because nothing ever put them in the FILE. The payload builder would have
// carried them happily.
//
// So this file asks the other question — for every table the manifest says is
// carried, does an exported bundle actually contain it?

import { describe, expect, it } from "vitest";
import { buildBackupBundle, type BackupParts } from "@/lib/backup-bundle";
import { BACKUP_MANIFEST, type TableName } from "@/lib/backup-manifest";
import { CURRENT_BACKUP_VERSION, SUPPORTED_BACKUP_VERSIONS } from "@/lib/import-remap";

const ts = "2026-01-01T00:00:00Z";

/**
 * One row for every table, with the nested rows populated too — a bundle whose
 * opCodes have no subOpCodes would satisfy "opCodes[].subOpCodes" vacuously and
 * hide exactly the omission this file is looking for.
 */
function fullParts(): BackupParts {
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
    } as unknown as BackupParts["settings"],
    entries: [
      {
        id: "E1",
        date: "2026-01-01",
        roNumber: "12345",
        opCodes: [{ id: "L1", opCodeId: "O1", position: 0 }],
      },
    ] as unknown as BackupParts["entries"],
    opCodes: [
      {
        id: "O1",
        code: "LOF",
        subOpCodes: [{ id: "V1", opCodeId: "O1", code: "LOF-SYN" }],
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
      { id: "D1", periodKey: "2026-01-P1", lines: [{ id: "DL1", code: "LOF" }] },
    ] as unknown as BackupParts["disputes"],
    unpaidTime: [{ id: "U1", date: "2026-01-01", hours: 1 }] as unknown as BackupParts["unpaidTime"],
    workSchedules: [
      { id: "S1", effectiveFrom: "2026-01-01", rotationWeeks: 1, anchorMonday: "2025-12-29", weeks: [] },
    ] as unknown as BackupParts["workSchedules"],
    daysOff: [{ id: "DO1", startDate: "2026-02-01", endDate: "2026-02-07", createdAt: ts }],
    shiftOverrides: {
      "2026-01-05": { start: "08:00", end: "17:00", breakMin: 60 },
    } as unknown as BackupParts["shiftOverrides"],
    confirmedZeroDays: ["2026-01-06"],
    portfolioSnapshots: [
      { id: "P1", seq: 1, roThreshold: 100, stats: {}, createdAt: ts },
    ] as unknown as BackupParts["portfolioSnapshots"],
    careerMilestones: [{ threshold: 100, achievedAt: ts }],
  };
}

/**
 * Resolves a manifest bundleKey ("disputes[].lines") against a built bundle.
 * A `[]` segment means "descend into the first element", which is why the
 * fixture above has to populate the nested arrays.
 */
function resolve(bundle: unknown, bundleKey: string): { found: boolean; value: unknown } {
  let cur: unknown = bundle;
  for (const rawSeg of bundleKey.split(".")) {
    const intoArray = rawSeg.endsWith("[]");
    const key = intoArray ? rawSeg.slice(0, -2) : rawSeg;

    if (typeof cur !== "object" || cur === null) return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[key];

    if (intoArray) {
      if (!Array.isArray(cur) || cur.length === 0) return { found: false, value: undefined };
      cur = cur[0];
    }
  }
  return { found: true, value: cur };
}

const carriedTables = (Object.keys(BACKUP_MANIFEST) as TableName[]).filter(
  (t) => BACKUP_MANIFEST[t].carried,
);

describe("backup manifest ↔ exported bundle", () => {
  const bundle = buildBackupBundle(fullParts(), ts);

  it.each(carriedTables)("%s: the exported bundle carries it", (table) => {
    const m = BACKUP_MANIFEST[table];
    if (!m.carried) throw new Error("filtered above");

    const { found, value } = resolve(bundle, m.bundleKey);
    expect(
      found,
      `${table} is marked \`carried\` in BACKUP_MANIFEST under "${m.bundleKey}", but ` +
        `buildBackupBundle never emits it — the backup file would not describe the ` +
        `table at all, and import would silently leave it behind`,
    ).toBe(true);
    expect(value, `${table} resolved to nothing at "${m.bundleKey}"`).toBeDefined();
  });

  it("does not carry a table the manifest excludes", () => {
    // entry_photos is the interesting one: the METADATA key is in the bundle by
    // design, but the table is marked not-carried because the binaries aren't.
    // Everything else excluded must be absent outright.
    const notCarried = (Object.keys(BACKUP_MANIFEST) as TableName[]).filter(
      (t) => !BACKUP_MANIFEST[t].carried && t !== "entry_photos",
    );
    for (const table of notCarried) {
      expect(Object.prototype.hasOwnProperty.call(bundle, table)).toBe(false);
    }
  });

  it("stamps the current version, and import accepts it", () => {
    expect(bundle.version).toBe(CURRENT_BACKUP_VERSION);
    // The Aug 5 → Aug 12 outage in one assertion: export moved to v2 and the
    // client-side file picker still rejected anything but v1, so every backup
    // the app produced for a week bounced before reaching the confirm step.
    expect(SUPPORTED_BACKUP_VERSIONS).toContain(CURRENT_BACKUP_VERSION);
  });

  it("never puts is_admin in the file", () => {
    expect(bundle.settings).not.toHaveProperty("is_admin");
    expect(bundle.settings).not.toHaveProperty("isAdmin");
  });

  it("carries all eight settings fields, not just the two v1 had", () => {
    // Listed literally rather than derived: the manifest's column names are
    // snake_case DB columns and the bundle's are camelCase, so deriving one from
    // the other would just re-encode the mapping this is meant to check.
    for (const field of [
      "splitDay",
      "periodOverrides",
      "goalHours",
      "tagColors",
      "referenceHourlyRate",
      "roTemplates",
      "defaultLaborType",
      "shareLaborTimes",
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(bundle.settings, field),
        `settings.${field} missing — restoring this file would leave the destination's value`,
      ).toBe(true);
    }
  });

  describe("null vs empty — the distinction import depends on", () => {
    it("omits the key when a Safe read reports a pre-migration table as null", () => {
      const bundle = buildBackupBundle(
        { ...fullParts(), workSchedules: null, careerMilestones: null },
        ts,
      );
      // Absent means "this backup does not describe the schedule", and the RPC
      // leaves the destination's rows alone. Present-but-null would be read as a
      // real value and is never emitted.
      expect(Object.prototype.hasOwnProperty.call(bundle, "workSchedules")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(bundle, "careerMilestones")).toBe(false);
    });

    it("KEEPS the key when the table is genuinely empty", () => {
      const bundle = buildBackupBundle(
        { ...fullParts(), workSchedules: [], daysOff: [], confirmedZeroDays: [] },
        ts,
      );
      // A user who deleted all their days off has an empty table, and restoring
      // that backup must clear the destination's — which only happens if the key
      // is present. Collapsing empty to absent would make deletions un-restorable.
      expect(bundle.workSchedules).toEqual([]);
      expect(bundle.daysOff).toEqual([]);
      expect(bundle.confirmedZeroDays).toEqual([]);
    });
  });
});
