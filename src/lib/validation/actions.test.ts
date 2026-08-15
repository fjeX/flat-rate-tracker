import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { check, validate } from "./core";
import {
  addLineSchema,
  attachTimerSchema,
  bugTriageSchema,
  dailyClockSchema,
  dayOffSchema,
  disputeOutcomeSchema,
  entryIdSchema,
  goalHoursSchema,
  importBundleSchema,
  laborRatesSchema,
  newBonusSchema,
  newEntrySchema,
  offsetSchema,
  openDisputeSchema,
  periodKeySchema,
  reorderOpCodesSchema,
  roTemplateSchema,
  signInSchema,
  submitBugSchema,
  timerStatusSchema,
  timezoneSchema,
  updatePasswordSchema,
  workScheduleSchema,
} from "./actions";

const UUID = "11111111-2222-4333-8444-555555555555";
const UUID_B = "99999999-8888-4777-8666-555555555555";

/** A minimal RO line that every entry test starts from. */
function line(overrides: Record<string, unknown> = {}) {
  return {
    opCodeId: null,
    custom: true,
    customCode: "LOF",
    customDescription: "Lube oil filter",
    flagHours: 0.5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    ...overrides,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-08-14",
    roNumber: "  40381  ",
    vehicle: { year: "2018", make: "Toyota", model: "Camry", vin: "", mileage: "" },
    notes: "",
    opCodes: [line()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The two properties the whole layer rests on
// ---------------------------------------------------------------------------

describe("the parsed value is a whitelist", () => {
  it("drops keys the schema doesn't declare, at every level", () => {
    const clean = validate(
      newEntrySchema,
      entry({
        userId: "someone-else",
        isAdmin: true,
        flagHours: 999,
        opCodes: [line({ id: UUID, userId: "someone-else", paidHours: 3 })],
      }),
    );

    expect(clean).not.toHaveProperty("userId");
    expect(clean).not.toHaveProperty("isAdmin");
    // flagHours on the ENTRY is a denormalized column a DB trigger owns; the
    // form has never sent one and a caller doesn't get to.
    expect(clean).not.toHaveProperty("flagHours");
    expect(clean.opCodes[0]).not.toHaveProperty("userId");

    // ...while the declared fields all survive, so the assertions above aren't
    // passing because the parse quietly returned an empty object.
    expect(clean.roNumber).toBe("40381");
    expect(clean.opCodes[0].id).toBe(UUID);
    expect(clean.opCodes[0].paidHours).toBe(3);
  });

  it("fills the DB's own defaults for fields an older client omits", () => {
    // The guest-mode sync replays entries written by whatever build was live
    // when they were logged. A missing optional field reached a column default
    // before this layer existed and still has to.
    const clean = validate(newEntrySchema, {
      date: "2026-08-14",
      roNumber: "40381",
      opCodes: [{ flagHours: 1.2 }],
    });

    expect(clean.vehicle).toEqual({ year: "", make: "", model: "", vin: "", mileage: "" });
    expect(clean.notes).toBe("");
    expect(clean.opCodes[0]).toMatchObject({
      opCodeId: null,
      custom: false,
      customCode: null,
      notes: "",
      position: 0,
      laborType: null,
    });
  });
});

describe("validate()", () => {
  it("throws the schema's own sentence, not a zod dump", () => {
    expect(() => validate(goalHoursSchema, 0)).toThrow(
      "Goal hours must be a whole number between 1 and 999.",
    );
  });

  it("check() returns the same sentence instead of throwing", () => {
    const result = check(signInSchema, { email: "", password: "" });
    expect(result).toEqual({ ok: false, error: "Email and password are required." });
  });
});

// ---------------------------------------------------------------------------
// Per-action rejections. Each block asserts a REJECT and an ACCEPT, so a
// broken selector can't make the rejection pass vacuously.
// ---------------------------------------------------------------------------

describe("entries", () => {
  it("requires an RO number, a real date, and at least one line", () => {
    expect(() => validate(newEntrySchema, entry({ roNumber: "   " }))).toThrow(
      "RO number is required.",
    );
    expect(() => validate(newEntrySchema, entry({ date: "" }))).toThrow(
      "Date is required.",
    );
    expect(() => validate(newEntrySchema, entry({ date: "08/14/2026" }))).toThrow(
      "Date must be in YYYY-MM-DD format.",
    );
    // Matches the regex the action used to test and is not a day.
    expect(() => validate(newEntrySchema, entry({ date: "2026-02-31" }))).toThrow(
      "Date must be in YYYY-MM-DD format.",
    );
    expect(() => validate(newEntrySchema, entry({ opCodes: [] }))).toThrow(
      "Add at least one op code.",
    );
    expect(validate(newEntrySchema, entry()).date).toBe("2026-08-14");
  });

  it("refuses hours that aren't non-negative numbers", () => {
    const bad = ["1.5", NaN, Infinity, -0.25, null];
    for (const flagHours of bad) {
      expect(() =>
        validate(newEntrySchema, entry({ opCodes: [line({ flagHours })] })),
      ).toThrow("Flag hours must be a non-negative number.");
    }
    // numeric(5,2) tops out at 999.99 — Postgres refused this before we did.
    expect(() =>
      validate(newEntrySchema, entry({ opCodes: [line({ flagHours: 1000 })] })),
    ).toThrow("Flag hours can't be more than 999.99");
    expect(
      validate(newEntrySchema, entry({ opCodes: [line({ flagHours: 999.99 })] }))
        .opCodes[0].flagHours,
    ).toBe(999.99);
  });

  it("refuses ids that aren't ids", () => {
    for (const id of ["", "'; drop table entries; --", "1", null, {}]) {
      expect(() => validate(entryIdSchema, id)).toThrow();
    }
    expect(validate(entryIdSchema, UUID)).toBe(UUID);
  });

  it("takes the line for addOpCodeLine without a position", () => {
    const clean = validate(addLineSchema, { entryId: UUID, line: line() });
    expect(clean.line).not.toHaveProperty("position");
    expect(clean.line.flagHours).toBe(0.5);
  });

  it("bounds the paging offset", () => {
    expect(() => validate(offsetSchema, -1)).toThrow("Offset can't be negative.");
    expect(() => validate(offsetSchema, 2.5)).toThrow("Offset must be a whole number.");
    expect(validate(offsetSchema, 100)).toBe(100);
  });
});

describe("money and periods", () => {
  it("refuses a spiff with an unknown category or a silly amount", () => {
    const base = { date: "2026-08-14", amount: 50, category: "spiff" };
    expect(() => validate(newBonusSchema, { ...base, category: "raise" })).toThrow(
      "Unknown category: raise",
    );
    expect(() => validate(newBonusSchema, { ...base, amount: -1 })).toThrow(
      "Amount must be a dollar figure of $0 or more.",
    );
    expect(() => validate(newBonusSchema, { ...base, amount: 1_000_000 })).toThrow();
    expect(validate(newBonusSchema, base).amount).toBe(50);
  });

  it("only accepts a period key the resolver can resolve", () => {
    for (const key of ["", "2026-08", "2026-13-P1", "2026-08-P3", "../../etc"]) {
      expect(() => validate(periodKeySchema, key)).toThrow("Period key is required.");
    }
    expect(validate(periodKeySchema, "2026-08-P2")).toBe("2026-08-P2");
  });

  it("keeps the dispute ledger's own wording", () => {
    expect(() =>
      validate(disputeOutcomeSchema, {
        id: UUID,
        input: { recoveredHours: -1 },
      }),
    ).toThrow("Recovered hours must be an hours figure of 0 or more.");
    expect(() =>
      validate(disputeOutcomeSchema, {
        id: UUID,
        input: { recoveredHours: 4, status: "settled" },
      }),
    ).toThrow("Unknown status: settled");
    expect(
      validate(disputeOutcomeSchema, {
        id: UUID,
        input: { recoveredHours: 4, status: "resolved" },
      }).input.recoveredHours,
    ).toBe(4);
  });

  it("defaults an opened dispute to excluding pending lines", () => {
    // The default that keeps a claim matching the number the tech was shown.
    expect(validate(openDisputeSchema, { periodKey: "2026-08-P1" }).options)
      .toEqual({});
    expect(
      validate(openDisputeSchema, {
        periodKey: "2026-08-P1",
        options: { includePending: true, scope: "everything" },
      }).options,
    ).toEqual({ includePending: true });
  });

  it("rejects a whole rate table rather than half-applying it", () => {
    const rates = [
      { laborType: "customer_pay", hourlyRate: 32 },
      { laborType: "warranty", hourlyRate: 24 },
      { laborType: "internal", hourlyRate: 10_000 },
    ];
    expect(() => validate(laborRatesSchema, rates)).toThrow(
      "Rate must be a number between 0 and 9999.",
    );
    expect(() => validate(laborRatesSchema, [{ laborType: "bonus_pay", hourlyRate: 1 }]))
      .toThrow("Unknown labor type: bonus_pay");
    expect(validate(laborRatesSchema, rates.slice(0, 2))).toHaveLength(2);
  });
});

describe("clock, schedule and timers", () => {
  it("caps daily clock hours at the column's ceiling", () => {
    expect(() => validate(dailyClockSchema, { date: "2026-08-14", hours: -1 })).toThrow(
      "Hours must be a non-negative number.",
    );
    expect(() => validate(dailyClockSchema, { date: "14-08-2026", hours: 8 })).toThrow(
      "Invalid date format.",
    );
    expect(() => validate(dailyClockSchema, { date: "2026-08-14", hours: 100 })).toThrow();
    expect(validate(dailyClockSchema, { date: "2026-08-14", hours: 8.5 }).hours).toBe(8.5);
  });

  it("refuses a day-off range that runs backwards", () => {
    expect(() =>
      validate(dayOffSchema, { startDate: "2026-08-20", endDate: "2026-08-14" }),
    ).toThrow("Start date must be on or before end date.");
    expect(
      validate(dayOffSchema, { startDate: "2026-08-14", endDate: "2026-08-20" }).endDate,
    ).toBe("2026-08-20");
  });

  it("refuses shift times that aren't times", () => {
    const week = {
      mon: { start: "07:00", end: "16:00", breakMin: 30 },
      tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    };
    const good = { effectiveFrom: "2026-08-14", rotationWeeks: 1, weeks: [week] };
    expect(() =>
      validate(workScheduleSchema, {
        ...good,
        weeks: [{ ...week, mon: { start: "25:00", end: "16:00", breakMin: 30 } }],
      }),
    ).toThrow("Shift times must look like 07:30.");
    expect(() => validate(workScheduleSchema, { ...good, rotationWeeks: 3 })).toThrow(
      "Rotation must be 1 or 2 weeks.",
    );
    expect(validate(workScheduleSchema, good).weeks).toHaveLength(1);
  });

  it("only accepts timer statuses the timer knows", () => {
    expect(() => validate(timerStatusSchema, { timerId: UUID, status: "sleeping" }))
      .toThrow("Unknown timer status.");
    expect(validate(timerStatusSchema, { timerId: UUID, status: "working" }).status)
      .toBe("working");
  });

  it("keeps the attach action's own copy for a missing RO", () => {
    expect(() => validate(attachTimerSchema, { entryId: "", lineId: null })).toThrow(
      "Pick an RO first.",
    );
    expect(validate(attachTimerSchema, { entryId: UUID }).lineId).toBe(null);
    expect(validate(attachTimerSchema, { entryId: UUID, lineId: UUID_B }).lineId)
      .toBe(UUID_B);
  });
});

describe("settings, templates and the backup file", () => {
  it("refuses a timezone that could carry more than a timezone", () => {
    for (const tz of ["America/Los_Angeles\nSet-Cookie: x=1", "a".repeat(80), ""]) {
      expect(() => validate(timezoneSchema, tz)).toThrow("Invalid timezone.");
    }
    expect(validate(timezoneSchema, "America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(validate(timezoneSchema, "Etc/GMT+8")).toBe("Etc/GMT+8");
  });

  it("keeps template regions inside the image", () => {
    const region = { field: "roNumber", x: 10, y: 10, width: 20, height: 5 };
    const good = { id: "t1", name: "Page 1", regions: [region] };
    expect(() => validate(roTemplateSchema, { ...good, regions: [] })).toThrow(
      "At least one region is required.",
    );
    expect(() =>
      validate(roTemplateSchema, { ...good, regions: [{ ...region, x: 140 }] }),
    ).toThrow("That template region is out of bounds.");
    expect(() =>
      validate(roTemplateSchema, { ...good, regions: [{ ...region, field: "price" }] }),
    ).toThrow("Unrecognized template field.");
    // A path outside the caller's own folder is refused by the action; a path
    // that tries to climb out of the bucket is refused here.
    expect(() =>
      validate(roTemplateSchema, { ...good, existingStoragePath: "../../secrets" }),
    ).toThrow("Invalid template image path.");
    expect(validate(roTemplateSchema, good).regions).toHaveLength(1);
  });

  it("strips a privilege flag out of a hand-edited backup's settings", () => {
    const bundle = {
      version: 3,
      exportedAt: "2026-08-14T00:00:00.000Z",
      settings: { splitDay: 15, periodOverrides: {}, is_admin: true, isAdmin: true },
      entries: [],
      opCodes: [],
    };
    const clean = validate(importBundleSchema, bundle);
    expect(clean.settings).not.toHaveProperty("is_admin");
    expect(clean.settings).not.toHaveProperty("isAdmin");
    expect(clean.settings.splitDay).toBe(15);
  });

  it("lets unknown ROW keys through, because dropping them would be data loss", () => {
    const clean = validate(importBundleSchema, {
      version: 3,
      settings: { splitDay: 15 },
      entries: [{ id: UUID, roNumber: "40381", someColumnAddedLater: "keep me" }],
      opCodes: [],
    });
    expect(clean.entries[0]).toHaveProperty("someColumnAddedLater", "keep me");
  });

  it("refuses a file that isn't shaped like a backup at all", () => {
    expect(() => validate(importBundleSchema, { version: 3, settings: {} })).toThrow(
      "Invalid backup format.",
    );
    expect(() =>
      validate(importBundleSchema, { version: 3, settings: {}, entries: {}, opCodes: [] }),
    ).toThrow("Invalid backup format.");
  });
});

describe("auth and bug reports", () => {
  it("refuses a password change where the confirmation doesn't match", () => {
    const base = {
      currentPassword: "old-password",
      newPassword: "new-password",
      confirmPassword: "new-password",
    };
    expect(check(updatePasswordSchema, { ...base, newPassword: "short" }).ok).toBe(false);
    expect(
      check(updatePasswordSchema, { ...base, confirmPassword: "typo" }),
    ).toEqual({ ok: false, error: "Passwords do not match." });
    expect(check(updatePasswordSchema, base).ok).toBe(true);
  });

  it("truncates auto-captured context instead of throwing the report away", () => {
    const clean = validate(submitBugSchema, {
      description: "the save button does nothing",
      userAgent: "U".repeat(5000),
      pageUrl: null,
      viewport: undefined,
    });
    expect(clean.userAgent).toHaveLength(1024);
    expect(clean.pageUrl).toBe(null);
    expect(clean.viewport).toBe(null);
    expect(clean.description).toBe("the save button does nothing");
  });

  it("still refuses an empty bug description", () => {
    expect(() => validate(submitBugSchema, { description: "   " })).toThrow(
      "Please describe the bug before sending.",
    );
  });

  it("accepts '' as clear-this for triage, and nothing else off-vocabulary", () => {
    expect(() =>
      validate(bugTriageSchema, { reportId: UUID, patch: { severity: "Urgent" } }),
    ).toThrow("Invalid severity.");
    const clean = validate(bugTriageSchema, {
      reportId: UUID,
      patch: { severity: "", status: "Triaged" },
    });
    expect(clean.patch.severity).toBe("");
    expect(clean.patch.status).toBe("Triaged");
  });

  it("refuses a reorder list carrying anything that isn't an id", () => {
    expect(() => validate(reorderOpCodesSchema, [UUID, ""])).toThrow(
      "All op code ids must be non-empty strings.",
    );
    expect(() => validate(reorderOpCodesSchema, "not-an-array")).toThrow(
      "Expected an array of op code ids.",
    );
    expect(validate(reorderOpCodesSchema, [UUID, UUID_B])).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Coverage gate
// ---------------------------------------------------------------------------

/**
 * Every exported action that takes an argument must validate it.
 *
 * A schema file can't prove anything about an action that never calls it, and
 * the failure mode of this whole layer is a new action shipped without one —
 * which looks exactly like a validated action from the outside. This reads the
 * source and fails on the omission.
 *
 * An action with no parameters has nothing to validate and is exempt.
 */
function unvalidatedActionsIn(source: string): string[] {
  // Split on the exported action boundaries, keeping each body with its head.
  const parts = source.split(/\nexport async function /).slice(1);
  const unvalidated: string[] = [];

  for (const part of parts) {
    const open = part.indexOf("(");
    const name = part.slice(0, open);
    // Walk to the matching paren — a parameter list contains parens of its own
    // (`{ a }: { a: () => void }`), so indexOf(")") is not the end of it.
    let depth = 0;
    let close = open;
    for (let i = open; i < part.length; i++) {
      if (part[i] === "(") depth++;
      else if (part[i] === ")" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (part.slice(open + 1, close).trim() === "") continue; // nothing to validate
    if (!/\bvalidate\(|\bcheck\(/.test(part)) unvalidated.push(name);
  }
  return unvalidated;
}

describe("coverage: every action with an argument validates it", () => {
  const dir = join(process.cwd(), "src/app/actions");
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it("actually detects an action that skipped validation", () => {
    // The gate reports "all clear" by returning an empty array, which is also
    // what a broken detector returns. Pin it against sources where it MUST
    // find something, and one where it must not.
    const skipped = `
export async function deleteThingAction(id: string): Promise<void> {
  await db.deleteThing(id);
}
`;
    const guarded = `
export async function deleteThingAction(id: string): Promise<void> {
  const clean = validate(idSchema, id);
  await db.deleteThing(clean);
}
`;
    const noArguments = `
export async function signOut() {
  await supabase.auth.signOut();
}
`;
    expect(unvalidatedActionsIn(skipped)).toEqual(["deleteThingAction"]);
    expect(unvalidatedActionsIn(guarded)).toEqual([]);
    expect(unvalidatedActionsIn(noArguments)).toEqual([]);
  });

  it("finds the action modules at all", () => {
    // An empty file list would make every check below pass without examining a
    // single action.
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  for (const file of files) {
    it(`${file}`, () => {
      const source = readFileSync(join(dir, file), "utf8");
      expect(unvalidatedActionsIn(source)).toEqual([]);
    });
  }
});
