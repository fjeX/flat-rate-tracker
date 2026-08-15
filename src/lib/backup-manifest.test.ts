// The half of the coverage guard that types cannot do.
//
// backup-manifest.ts is checked against the schema BY THE COMPILER: a mapped
// type forces an entry for every table and every column, so a migration that
// adds either won't build until someone declares its disposition.
//
// That proves the manifest describes the schema. It does not prove the CODE
// obeys the manifest — writing `goal_hours: "carry"` and then forgetting the
// line in buildImportPayload compiles perfectly and drops the column exactly
// the way it was dropped before. These tests close that gap by running the real
// payload builder over a bundle populated in every table and comparing the keys
// it emits against what the manifest promised.
//
// Why key presence and not just values: the RPC populates rows with
// jsonb_populate_recordset against a null base, so an omitted key lands as NULL
// rather than the column default. `undefined` here means data loss there.

import { describe, it, expect } from "vitest";
import {
  BACKUP_MANIFEST,
  carriedColumns,
  tablesUserShouldBeWarnedAbout,
  type TableName,
} from "./backup-manifest";
import { buildImportPayload, type ImportBundle, type ImportPayload } from "./import-remap";

// A bundle with at least one row in every carried table. Deliberately verbose
// rather than factory-built: this fixture's job is to be the thing that has to
// be updated when a column is added, so the omission is visible in the diff.
function fullBundle(): ImportBundle {
  const ts = "2026-01-01T00:00:00Z";
  return {
    version: 4,
    exportedAt: ts,
    settings: {
      splitDay: 15,
      periodOverrides: {},
      goalHours: 90,
      tagColors: { warranty: 3 },
      referenceHourlyRate: 32,
      roTemplates: [],
      defaultLaborType: "warranty",
      shareLaborTimes: true,
      trackRoTime: true,
    },
    opCodes: [
      {
        id: "OC1",
        userId: "OLD",
        code: "LOF",
        description: "Oil change",
        flagHours: 0.3,
        notes: "n",
        tags: ["t"],
        sortOrder: 0,
        createdAt: ts,
        subOpCodes: [
          {
            id: "SUB1",
            opCodeId: "OC1",
            userId: "OLD",
            code: "LOF-D",
            description: "Diesel",
            flagHours: 0.5,
            sortOrder: 0,
            createdAt: ts,
          },
        ],
      },
    ],
    entries: [
      {
        id: "E1",
        userId: "OLD",
        createdAt: ts,
        updatedAt: ts,
        date: "2026-01-01",
        loggedTime: "09:42",
        roNumber: "12345",
        vehicle: { year: "2020", make: "Ford", model: "F-150", vin: "V", mileage: "80000" },
        flagHours: 1,
        notes: "",
        comebackOfEntryId: null,
        comebackKind: null,
        opCodes: [
          {
            id: "L1",
            opCodeId: "OC1",
            subOpCodeId: "SUB1",
            custom: false,
            customCode: null,
            customDescription: null,
            flagHours: 1,
            actualHours: 0.8,
            paidHours: 1,
            isComeback: false,
            isUpsell: true,
            laborType: "warranty",
            notes: "",
            position: 0,
          },
        ],
      },
    ],
    dailyClocks: [{ userId: "OLD", date: "2026-01-01", hours: 8 }],
    paidPeriods: [{ userId: "OLD", periodKey: "2026-01-A", paidFlagHours: 40 }],
    bonuses: [
      {
        id: "B1",
        userId: "OLD",
        date: "2026-01-01",
        amount: 50,
        category: "spiff",
        source: "manufacturer",
        note: "",
        entryId: "E1",
        createdAt: ts,
        updatedAt: ts,
      },
    ],
    laborRates: [{ laborType: "warranty", hourlyRate: 32 }],
    disputes: [
      {
        id: "D1",
        periodKey: "2026-01-A",
        periodLabel: "Jan A",
        scope: "period",
        status: "submitted",
        claimedHours: 3,
        claimedDollars: 96,
        recoveredHours: 0,
        recoveredDollars: 0,
        generatedAt: ts,
        submittedAt: ts,
        answeredAt: null,
        resolvedAt: null,
        note: "",
        createdAt: ts,
        updatedAt: ts,
        lines: [
          {
            id: "DL1",
            entryId: "E1",
            lineId: "L1",
            roNumber: "12345",
            code: "LOF",
            description: "Oil change",
            workDate: "2026-01-01",
            flaggedHours: 1,
            paidHours: 0,
            claimedHours: 1,
            claimedDollars: 32,
            recoveredHours: 0,
            recoveredDollars: 0,
            hadPhoto: false,
            position: 0,
          },
        ],
      },
    ] as unknown as ImportBundle["disputes"],
    unpaidTime: [
      {
        id: "U1",
        date: "2026-01-01",
        hours: 1.5,
        kind: "comeback",
        entryId: "E1",
        originalEntryId: "E1",
        source: "manual",
        note: "",
        createdAt: ts,
        updatedAt: ts,
      },
    ] as unknown as ImportBundle["unpaidTime"],
    // --- v3
    workSchedules: [
      {
        id: "S1",
        effectiveFrom: "2026-01-01",
        rotationWeeks: 2,
        anchorMonday: "2025-12-29",
        weeks: [],
        createdAt: ts,
      },
    ] as unknown as ImportBundle["workSchedules"],
    daysOff: [{ id: "DO1", startDate: "2026-02-01", endDate: "2026-02-07", createdAt: ts }],
    shiftOverrides: { "2026-01-05": { start: "08:00", end: "17:00", lunch: 0.5 } } as unknown as ImportBundle["shiftOverrides"],
    confirmedZeroDays: ["2026-01-06"],
    portfolioSnapshots: [
      { id: "P1", seq: 1, roThreshold: 100, stats: {}, createdAt: ts },
    ] as unknown as ImportBundle["portfolioSnapshots"],
    careerMilestones: [{ threshold: 100, achievedAt: ts }],
  };
}

const payload = buildImportPayload(fullBundle(), { newId: () => "NEW", now: "2026-06-01T00:00:00Z" });

/** Rows the payload holds for a table, flattened to a list of key sets. */
function rowsFor(table: TableName): Record<string, unknown>[] {
  // user_settings rides under `settings` as a single object, not an array.
  if (table === "user_settings") return [payload.settings as unknown as Record<string, unknown>];
  const rows = (payload as unknown as Record<string, unknown>)[table];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

const carriedTables = (Object.keys(BACKUP_MANIFEST) as TableName[]).filter(
  (t) => BACKUP_MANIFEST[t].carried,
);

describe("backup manifest ↔ import payload", () => {
  it.each(carriedTables)(
    "%s: the payload emits every column the manifest marks `carry`",
    (table) => {
      const rows = rowsFor(table);
      // A carried table with no rows means the fixture above is incomplete, not
      // that the table is fine — an empty array trivially satisfies every
      // key check below and would hide a real omission.
      expect(rows.length, `fixture has no ${table} rows to check`).toBeGreaterThan(0);

      const expected = carriedColumns(table);
      for (const row of rows) {
        for (const col of expected) {
          expect(
            Object.prototype.hasOwnProperty.call(row, col),
            `${table}.${col} is marked \`carry\` but buildImportPayload never emits it — ` +
              `the RPC would write NULL, not the column default`,
          ).toBe(true);
        }
      }
    },
  );

  it("never emits a column marked `exclude` — is_admin is the one that matters", () => {
    for (const table of carriedTables) {
      const m = BACKUP_MANIFEST[table];
      if (!m.carried) continue;
      const excluded = Object.entries(m.columns)
        .filter(([, d]) => typeof d === "object")
        .map(([c]) => c);
      for (const row of rowsFor(table)) {
        for (const col of excluded) {
          expect(
            Object.prototype.hasOwnProperty.call(row, col),
            `${table}.${col} is excluded but the payload carries it`,
          ).toBe(false);
        }
      }
    }
  });

  it("a crafted backup cannot smuggle is_admin into the payload", () => {
    // The realistic attack: a user opens their own backup in a text editor and
    // adds the flag. The payload builder must ignore it outright — the RPC is
    // the real boundary, but nothing should be carrying it this far either.
    const hostile = fullBundle() as ImportBundle & { settings: Record<string, unknown> };
    hostile.settings.is_admin = true;
    hostile.settings.isAdmin = true;
    const built = buildImportPayload(hostile, { newId: () => "NEW" });
    expect(built.settings).not.toHaveProperty("is_admin");
    expect(built.settings).not.toHaveProperty("isAdmin");
  });

  it("every uncarried table states a reason", () => {
    for (const [table, m] of Object.entries(BACKUP_MANIFEST)) {
      if (m.carried) continue;
      expect(m.reason.trim().length, `${table} is excluded with no reason`).toBeGreaterThan(20);
    }
  });

  it("names the exclusions the import screen has to warn about", () => {
    const warned = tablesUserShouldBeWarnedAbout().map((w) => w.table);
    // Both hold real user data that stays behind on an account switch, so both
    // must reach the preflight screen rather than being silently absent.
    expect(warned).toContain("entry_photos");
    expect(warned).toContain("labor_time_observations");
  });

  it("declares a bundle key for every carried table", () => {
    for (const table of carriedTables) {
      const m = BACKUP_MANIFEST[table];
      if (!m.carried) continue;
      expect(m.bundleKey.length, `${table} has no bundleKey`).toBeGreaterThan(0);
    }
  });
});

describe("payload shape", () => {
  it("carries all six v3 tables when the bundle has them", () => {
    const keys: (keyof ImportPayload)[] = [
      "work_schedules",
      "days_off",
      "work_shift_overrides",
      "confirmed_zero_days",
      "portfolio_snapshots",
      "career_milestones",
    ];
    for (const k of keys) expect(payload[k], `${k} missing from payload`).toBeDefined();
  });

  it("omits v3 tables entirely for an older backup, rather than emptying them", () => {
    // "Absent" is meaningful: the RPC replaces a table only when the payload
    // carries its key, so a v1/v2 restore must leave the schedule alone instead
    // of wiping it.
    const old = fullBundle();
    delete old.workSchedules;
    delete old.daysOff;
    delete old.confirmedZeroDays;
    const built = buildImportPayload(old, { newId: () => "NEW" });
    expect(built).not.toHaveProperty("work_schedules");
    expect(built).not.toHaveProperty("days_off");
    expect(built).not.toHaveProperty("confirmed_zero_days");
  });

  it("keeps anchor_monday verbatim so a 2-week rotation stays in phase", () => {
    expect(payload.work_schedules?.[0]).toMatchObject({
      anchor_monday: "2025-12-29",
      rotation_weeks: 2,
    });
  });

  // --- v4: three columns, and the pre-v4 file that never mentions them -----
  //
  // The failure this pins is not "the value is wrong", it is "the KEY is
  // missing". is_upsell is NOT NULL, and the RPC populates rows against a null
  // base, so an absent key writes NULL and rolls the entire import back — a
  // backup taken last week would stop restoring at all.
  it("fills the v4 columns for a backup written before they existed", () => {
    const old = fullBundle();
    delete old.entries[0].loggedTime;
    delete old.entries[0].opCodes[0].isUpsell;
    delete old.settings.trackRoTime;
    const built = buildImportPayload(old, { newId: () => "NEW" });

    expect(built.entries[0]).toHaveProperty("logged_time", null);
    expect(built.entry_op_codes[0]).toHaveProperty("is_upsell", false);
    // Settings are the opposite rule: absent must stay absent, or restoring an
    // old file would reset a preference the destination account already made.
    expect(built.settings).not.toHaveProperty("track_ro_time");
  });

  it("refuses to call a comeback line an upsell, even from a hand-edited file", () => {
    // The DB CHECK (entry_op_codes_upsell_not_comeback) would reject the row and
    // roll back the whole import. Resolving it here means a file someone edited
    // by hand still restores, minus a claim that contradicts itself.
    const hostile = fullBundle();
    hostile.entries[0].opCodes[0].isComeback = true;
    hostile.entries[0].opCodes[0].isUpsell = true;
    const built = buildImportPayload(hostile, { newId: () => "NEW" });
    expect(built.entry_op_codes[0]).toMatchObject({
      is_comeback: true,
      is_upsell: false,
    });
  });

  it("keeps the date a milestone was actually achieved", () => {
    expect(payload.career_milestones?.[0]).toMatchObject({
      threshold: 100,
      achieved_at: "2026-01-01T00:00:00Z",
    });
  });
});
