import { describe, it, expect } from "vitest";
import { buildImportPayload, CURRENT_BACKUP_VERSION, type ImportBundle } from "./import-remap";
import type { Dispute, Entry, EntryOpCode, OpCode, UnpaidTime } from "./types";

// Deterministic ids so assertions can name them: n1, n2, n3...
function counter() {
  let n = 0;
  return () => `n${++n}`;
}

function line(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: "L1",
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
    isComeback: false,
    ...over,
  };
}

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "E1",
    userId: "OLD-USER",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    date: "2026-01-01",
    roNumber: "12345",
    vehicle: { year: "2020", make: "Ford", model: "F-150", vin: "VIN1", mileage: "80000" },
    opCodes: [],
    flagHours: 1,
    notes: "",
    comebackOfEntryId: null,
    comebackKind: null,
    ...over,
  };
}

function opCode(over: Partial<OpCode> = {}): OpCode {
  return {
    id: "OC1",
    userId: "OLD-USER",
    code: "LOF",
    description: "Oil change",
    flagHours: 0.3,
    notes: "",
    tags: [],
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    subOpCodes: [],
    ...over,
  };
}

function bundle(over: Partial<ImportBundle> = {}): ImportBundle {
  return {
    version: CURRENT_BACKUP_VERSION,
    exportedAt: "2026-08-05T00:00:00Z",
    settings: { splitDay: 15, periodOverrides: {} },
    entries: [],
    opCodes: [],
    dailyClocks: [],
    paidPeriods: [],
    ...over,
  };
}

describe("buildImportPayload — id remapping", () => {
  // The reported Critical bug: reusing the backup's ids collided with the SOURCE
  // account's still-present rows (23505 on op_codes_pkey), so migrating a backup
  // into a second account on the same database could never succeed.
  it("never reuses an id from the backup", () => {
    const payload = buildImportPayload(
      bundle({
        opCodes: [opCode({ id: "OC1" })],
        entries: [entry({ id: "E1", opCodes: [line({ id: "L1" })] })],
      }),
      { newId: counter() },
    );

    expect(payload.op_codes[0].id).not.toBe("OC1");
    expect(payload.entries[0].id).not.toBe("E1");
    expect(payload.entry_op_codes[0].id).not.toBe("L1");
  });

  it("re-points a line at its op code's NEW id", () => {
    const payload = buildImportPayload(
      bundle({
        opCodes: [opCode({ id: "OC1" })],
        entries: [entry({ id: "E1", opCodes: [line({ id: "L1", opCodeId: "OC1" })] })],
      }),
      { newId: counter() },
    );

    const newOpCodeId = payload.op_codes[0].id;
    expect(payload.entry_op_codes[0].op_code_id).toBe(newOpCodeId);
    expect(payload.entry_op_codes[0].entry_id).toBe(payload.entries[0].id);
  });

  it("resolves a comeback pointing at an RO logged LATER in the file", () => {
    // Order matters: E2 references E1 but a redo can just as easily reference an
    // RO further down the list, so ids are minted in a pass before resolution.
    const payload = buildImportPayload(
      bundle({
        entries: [
          entry({ id: "E2", comebackOfEntryId: "E1", comebackKind: "comeback_own" }),
          entry({ id: "E1" }),
        ],
      }),
      { newId: counter() },
    );

    const newE1 = payload.entries[1].id;
    expect(payload.entries[0].comeback_of_entry_id).toBe(newE1);
  });

  // The rule that keeps a shared database safe: an id that isn't in the bundle
  // must not survive the trip, or the imported row points at a STRANGER's record.
  it("nulls a reference that does not resolve inside the bundle", () => {
    const payload = buildImportPayload(
      bundle({
        entries: [entry({ id: "E1", comebackOfEntryId: "SOMEONE-ELSES-RO" })],
        bonuses: [
          {
            id: "B1",
            userId: "OLD-USER",
            date: "2026-01-02",
            amount: 25,
            category: "spiff",
            source: null,
            note: null,
            entryId: "ALSO-NOT-HERE",
            createdAt: "2026-01-02T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
          },
        ],
      }),
      { newId: counter() },
    );

    expect(payload.entries[0].comeback_of_entry_id).toBeNull();
    expect(payload.bonuses[0].entry_id).toBeNull();
    // The link is lost but the FACT that it was rework survives.
    expect(payload.entries[0].comeback_kind).toBeNull();
  });

  it("keeps comeback_kind when the original RO is missing", () => {
    const payload = buildImportPayload(
      bundle({
        entries: [
          entry({ id: "E1", comebackOfEntryId: "GONE", comebackKind: "comeback_other" }),
        ],
      }),
      { newId: counter() },
    );

    expect(payload.entries[0].comeback_of_entry_id).toBeNull();
    expect(payload.entries[0].comeback_kind).toBe("comeback_other");
  });

  it("drops a variant whose parent op code is not in the bundle", () => {
    // op_code_variants.op_code_id is NOT NULL, so an unresolvable parent means
    // the row cannot be imported at all — dropping beats failing the import.
    const payload = buildImportPayload(
      bundle({
        opCodes: [
          opCode({
            id: "OC1",
            subOpCodes: [
              {
                id: "V1",
                opCodeId: "OC1",
                userId: "OLD-USER",
                code: "SYNTH",
                description: "Synthetic",
                flagHours: 0.4,
                sortOrder: 0,
                createdAt: "2026-01-01T00:00:00Z",
              },
              {
                id: "V2",
                opCodeId: "ORPHANED",
                userId: "OLD-USER",
                code: "BAD",
                description: "",
                flagHours: 0,
                sortOrder: 1,
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
          }),
        ],
      }),
      { newId: counter() },
    );

    expect(payload.op_code_variants).toHaveLength(1);
    expect(payload.op_code_variants[0].op_code_id).toBe(payload.op_codes[0].id);
  });

  it("re-points a line's sub_op_code_id at the variant's new id", () => {
    const payload = buildImportPayload(
      bundle({
        opCodes: [
          opCode({
            id: "OC1",
            subOpCodes: [
              {
                id: "V1",
                opCodeId: "OC1",
                userId: "OLD-USER",
                code: "SYNTH",
                description: "Synthetic",
                flagHours: 0.4,
                sortOrder: 0,
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
          }),
        ],
        entries: [
          entry({ id: "E1", opCodes: [line({ id: "L1", opCodeId: "OC1", subOpCodeId: "V1" })] }),
        ],
      }),
      { newId: counter() },
    );

    expect(payload.entry_op_codes[0].sub_op_code_id).toBe(payload.op_code_variants[0].id);
  });
});

describe("buildImportPayload — columns the old import silently dropped", () => {
  // These fields were all present in the backup JSON and never written back.
  // paid_hours is the whole reconciliation history; is_comeback is the entire
  // unpaid-rework feature; labor_type decides which rate prices the line.
  it("carries the reconciliation and rework state on a line", () => {
    const payload = buildImportPayload(
      bundle({
        entries: [
          entry({
            id: "E1",
            opCodes: [
              line({
                id: "L1",
                flagHours: 0,
                actualHours: 0.9,
                paidHours: 1.5,
                isComeback: true,
                laborType: "warranty",
                notes: "customer returned",
              }),
            ],
          }),
        ],
      }),
      { newId: counter() },
    );

    const row = payload.entry_op_codes[0];
    expect(row.paid_hours).toBe(1.5);
    expect(row.is_comeback).toBe(true);
    expect(row.labor_type).toBe("warranty");
    expect(row.notes).toBe("customer returned");
  });

  it("carries VIN and mileage on an entry", () => {
    const payload = buildImportPayload(
      bundle({ entries: [entry({ id: "E1" })] }),
      { newId: counter() },
    );

    expect(payload.entries[0].vehicle_vin).toBe("VIN1");
    expect(payload.entries[0].vehicle_mileage).toBe("80000");
  });

  it("carries op code notes and tags", () => {
    const payload = buildImportPayload(
      bundle({ opCodes: [opCode({ notes: "use synthetic", tags: ["Brakes", "Warranty"] })] }),
      { newId: counter() },
    );

    expect(payload.op_codes[0].notes).toBe("use synthetic");
    expect(payload.op_codes[0].tags).toEqual(["Brakes", "Warranty"]);
  });

  // A NOT NULL column arriving as undefined would be written as NULL by
  // jsonb_populate_recordset and fail the whole import.
  it("never emits undefined for a NOT NULL text column", () => {
    const payload = buildImportPayload(
      bundle({
        opCodes: [opCode({ notes: undefined as unknown as string, tags: undefined as unknown as string[] })],
        entries: [entry({ id: "E1", notes: undefined as unknown as string, opCodes: [line()] })],
      }),
      { newId: counter() },
    );

    expect(payload.op_codes[0].notes).toBe("");
    expect(payload.op_codes[0].tags).toEqual([]);
    expect(payload.entries[0].notes).toBe("");
    expect(payload.entry_op_codes[0].notes).toBe("");
  });
});

// The RPC populates rows with jsonb_populate_recordset against a NULL base, so
// an omitted key is written as NULL rather than the column's DEFAULT. That makes
// "forgot a column" a runtime constraint violation instead of a type error —
// TypeScript can't catch it, because the generated Insert types mark defaulted
// columns optional. This is the guard: the NOT NULL column list of each table
// the import writes, taken from the live schema.
describe("buildImportPayload — every NOT NULL column is emitted", () => {
  const NOT_NULL: Record<string, string[]> = {
    op_codes: ["id", "code", "description", "flag_hours", "sort_order", "created_at", "notes", "tags"],
    op_code_variants: ["id", "op_code_id", "code", "description", "flag_hours", "sort_order", "created_at"],
    entries: [
      "id", "date", "ro_number", "vehicle_year", "vehicle_make", "vehicle_model",
      "vehicle_mileage", "vehicle_vin", "flag_hours", "notes", "created_at", "updated_at",
    ],
    entry_op_codes: ["id", "entry_id", "custom", "flag_hours", "position", "notes", "is_comeback"],
    bonuses: ["id", "date", "amount", "category", "created_at", "updated_at"],
    daily_clock_hours: ["date", "hours"],
    paid_period_hours: ["period_key", "paid_flag_hours"],
    labor_rates: ["id", "labor_type", "hourly_rate", "created_at", "updated_at"],
    disputes: [
      "id", "period_key", "period_label", "scope", "status", "claimed_hours",
      "recovered_hours", "generated_at", "note", "created_at", "updated_at",
    ],
    dispute_lines: [
      "id", "dispute_id", "ro_number", "code", "description", "flagged_hours",
      "claimed_hours", "recovered_hours", "had_photo", "position", "created_at", "updated_at",
    ],
    unpaid_time: ["id", "date", "hours", "kind", "source", "note", "created_at", "updated_at"],
  };

  it("emits a defined value for every NOT NULL column of every table", () => {
    const payload = buildImportPayload(
      bundle({
        opCodes: [
          opCode({
            subOpCodes: [
              {
                id: "V1",
                opCodeId: "OC1",
                userId: "OLD",
                code: "SYN",
                description: "",
                flagHours: 0,
                sortOrder: 0,
                createdAt: "2026-01-01T00:00:00Z",
              },
            ],
          }),
        ],
        entries: [entry({ opCodes: [line()] })],
        dailyClocks: [{ userId: "OLD", date: "2026-01-01", hours: 8 }],
        paidPeriods: [{ userId: "OLD", periodKey: "2026-01-P1", paidFlagHours: 1 }],
        bonuses: [
          {
            id: "B1", userId: "OLD", date: "2026-01-01", amount: 1, category: "spiff",
            source: null, note: null, entryId: null,
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
        laborRates: [{ laborType: "customer_pay", hourlyRate: 32 }],
        unpaidTime: [
          {
            id: "U1", userId: "OLD", date: "2026-01-01", hours: 1, kind: "shop_time",
            entryId: null, originalEntryId: null, source: "manual", note: "",
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
        disputes: [
          {
            id: "D1", userId: "OLD", periodKey: "2026-01-P1", periodLabel: "Jan",
            scope: "lines", status: "generated", claimedHours: 1, claimedDollars: null,
            recoveredHours: 0, recoveredDollars: null, generatedAt: "2026-01-01T00:00:00Z",
            submittedAt: null, answeredAt: null, resolvedAt: null, note: "",
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
            lines: [
              {
                id: "DL1", disputeId: "D1", entryId: null, lineId: null, roNumber: "1",
                code: "X", description: "", workDate: null, flaggedHours: 0, paidHours: null,
                claimedHours: 0, claimedDollars: null, recoveredHours: 0,
                recoveredDollars: null, hadPhoto: false, position: 0,
              },
            ],
          },
        ],
      }),
      { newId: counter() },
    );

    for (const [table, columns] of Object.entries(NOT_NULL)) {
      const rows = (payload as unknown as Record<string, Record<string, unknown>[]>)[table];
      expect(rows, `${table} missing from payload`).toBeDefined();
      expect(rows.length, `${table} fixture produced no rows to check`).toBeGreaterThan(0);
      for (const column of columns) {
        expect(rows[0][column], `${table}.${column} would be written as NULL`).not.toBeUndefined();
        expect(rows[0][column], `${table}.${column} would be written as NULL`).not.toBeNull();
      }
    }
  });

  it("stamps dispute line timestamps from the parent claim", () => {
    // Regression: DisputeLine carries no timestamps, so these were omitted and
    // the NOT NULL created_at blew up the whole import at insert time.
    const payload = buildImportPayload(
      bundle({
        disputes: [
          {
            id: "D1", userId: "OLD", periodKey: "2026-01-P1", periodLabel: "Jan",
            scope: "lines", status: "generated", claimedHours: 1, claimedDollars: null,
            recoveredHours: 0, recoveredDollars: null, generatedAt: "2026-01-01T00:00:00Z",
            submittedAt: null, answeredAt: null, resolvedAt: null, note: "",
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
            lines: [
              {
                id: "DL1", disputeId: "D1", entryId: null, lineId: null, roNumber: "1",
                code: "X", description: "", workDate: null, flaggedHours: 0, paidHours: null,
                claimedHours: 0, claimedDollars: null, recoveredHours: 0,
                recoveredDollars: null, hadPhoto: false, position: 0,
              },
            ],
          },
        ],
      }),
      { newId: counter() },
    );

    expect(payload.dispute_lines?.[0].created_at).toBe("2026-01-01T00:00:00Z");
    expect(payload.dispute_lines?.[0].updated_at).toBe("2026-01-02T00:00:00Z");
  });
});

describe("buildImportPayload — version handling", () => {
  // "Absent" is meaningful: the RPC replaces a table only when the payload
  // carries its key, so a v1 restore must not empty tables the file never held.
  it("omits v2 sections entirely for a v1 backup", () => {
    const payload = buildImportPayload(bundle({ version: 1 }), { newId: counter() });

    expect(payload).not.toHaveProperty("labor_rates");
    expect(payload).not.toHaveProperty("disputes");
    expect(payload).not.toHaveProperty("unpaid_time");
  });

  it("emits an EMPTY v2 section when the backup carries an empty one", () => {
    // Distinct from absent: the account genuinely had no disputes, so import
    // should clear any that exist rather than leave them behind.
    const payload = buildImportPayload(
      bundle({ laborRates: [], disputes: [], unpaidTime: [] }),
      { newId: counter() },
    );

    expect(payload.labor_rates).toEqual([]);
    expect(payload.disputes).toEqual([]);
    expect(payload.unpaid_time).toEqual([]);
  });

  it("carries pay rates so a migrated account isn't priced at $0", () => {
    const payload = buildImportPayload(
      bundle({ laborRates: [{ laborType: "customer_pay", hourlyRate: 32 }] }),
      { newId: counter(), now: "2026-08-05T12:00:00Z" },
    );

    expect(payload.labor_rates?.[0]).toMatchObject({
      labor_type: "customer_pay",
      hourly_rate: 32,
      created_at: "2026-08-05T12:00:00Z",
    });
  });
});

describe("buildImportPayload — frozen dispute claims", () => {
  function dispute(over: Partial<Dispute> = {}): Dispute {
    return {
      id: "D1",
      userId: "OLD-USER",
      periodKey: "2026-08-P1",
      periodLabel: "Aug 1–15",
      scope: "lines",
      status: "resolved",
      claimedHours: 3,
      claimedDollars: 96,
      recoveredHours: 3,
      recoveredDollars: 96,
      generatedAt: "2026-08-05T00:00:00Z",
      submittedAt: null,
      answeredAt: null,
      resolvedAt: "2026-08-05T01:00:00Z",
      note: "paid in full",
      createdAt: "2026-08-05T00:00:00Z",
      updatedAt: "2026-08-05T01:00:00Z",
      lines: [],
      ...over,
    };
  }

  it("preserves the claimed and recovered figures verbatim", () => {
    const payload = buildImportPayload(
      bundle({ disputes: [dispute()] }),
      { newId: counter() },
    );

    expect(payload.disputes?.[0]).toMatchObject({
      claimed_hours: 3,
      claimed_dollars: 96,
      recovered_hours: 3,
      recovered_dollars: 96,
      status: "resolved",
    });
  });

  // A dispute is a frozen snapshot — it is valid after its RO is deleted, so a
  // line whose RO isn't in the bundle must still import, just without the link.
  it("imports a dispute line whose RO is not in the bundle", () => {
    const payload = buildImportPayload(
      bundle({
        disputes: [
          dispute({
            lines: [
              {
                id: "DL1",
                disputeId: "D1",
                entryId: "DELETED-RO",
                lineId: "DELETED-LINE",
                roNumber: "39104",
                code: "CV-AXLE",
                description: "Front CV axle",
                workDate: "2026-08-05",
                flaggedHours: 4,
                paidHours: 1,
                claimedHours: 3,
                claimedDollars: 96,
                recoveredHours: 3,
                recoveredDollars: 96,
                hadPhoto: false,
                position: 0,
              },
            ],
          }),
        ],
      }),
      { newId: counter() },
    );

    expect(payload.dispute_lines).toHaveLength(1);
    expect(payload.dispute_lines?.[0].entry_id).toBeNull();
    expect(payload.dispute_lines?.[0].line_id).toBeNull();
    // The claim itself is intact — that's the whole point of freezing it.
    expect(payload.dispute_lines?.[0].claimed_hours).toBe(3);
    expect(payload.dispute_lines?.[0].ro_number).toBe("39104");
  });

  it("links a dispute line to its dispute's new id", () => {
    const payload = buildImportPayload(
      bundle({
        disputes: [
          dispute({
            lines: [
              {
                id: "DL1",
                disputeId: "D1",
                entryId: null,
                lineId: null,
                roNumber: "1",
                code: "X",
                description: "",
                workDate: null,
                flaggedHours: 0,
                paidHours: null,
                claimedHours: 0,
                claimedDollars: null,
                recoveredHours: 0,
                recoveredDollars: null,
                hadPhoto: false,
                position: 0,
              },
            ],
          }),
        ],
      }),
      { newId: counter() },
    );

    expect(payload.dispute_lines?.[0].dispute_id).toBe(payload.disputes?.[0].id);
  });
});

describe("buildImportPayload — unpaid time", () => {
  function unpaid(over: Partial<UnpaidTime> = {}): UnpaidTime {
    return {
      id: "U1",
      userId: "OLD-USER",
      date: "2026-08-05",
      hours: 1.5,
      kind: "comeback_own",
      entryId: null,
      originalEntryId: null,
      source: "manual",
      note: "",
      createdAt: "2026-08-05T00:00:00Z",
      updatedAt: "2026-08-05T00:00:00Z",
      ...over,
    };
  }

  it("re-points both RO links at their new ids", () => {
    const payload = buildImportPayload(
      bundle({
        entries: [entry({ id: "E1" }), entry({ id: "E2" })],
        unpaidTime: [unpaid({ entryId: "E1", originalEntryId: "E2" })],
      }),
      { newId: counter() },
    );

    expect(payload.unpaid_time?.[0].entry_id).toBe(payload.entries[0].id);
    expect(payload.unpaid_time?.[0].original_entry_id).toBe(payload.entries[1].id);
  });

  it("keeps the hours when the RO link cannot be resolved", () => {
    const payload = buildImportPayload(
      bundle({ unpaidTime: [unpaid({ entryId: "GONE", hours: 3.3 })] }),
      { newId: counter() },
    );

    expect(payload.unpaid_time?.[0].entry_id).toBeNull();
    expect(payload.unpaid_time?.[0].hours).toBe(3.3);
  });
});

describe("buildImportPayload — settings and composite-keyed tables", () => {
  it("passes settings through in DB column form", () => {
    const payload = buildImportPayload(
      bundle({
        settings: { splitDay: 20, periodOverrides: { "2026-08-P1": { start: "2026-08-01", end: "2026-08-14" } } },
      }),
      { newId: counter() },
    );

    expect(payload.settings.split_day).toBe(20);
    expect(payload.settings.period_overrides).toEqual({
      "2026-08-P1": { start: "2026-08-01", end: "2026-08-14" },
    });
  });

  it("emits no id for composite-keyed rows", () => {
    // (user_id, date) and (user_id, period_key) are the whole key — there is no
    // surrogate id to collide, which is why these never hit the 23505 bug.
    const payload = buildImportPayload(
      bundle({
        dailyClocks: [{ userId: "OLD-USER", date: "2026-08-05", hours: 8 }],
        paidPeriods: [{ userId: "OLD-USER", periodKey: "2026-08-P1", paidFlagHours: 18 }],
      }),
      { newId: counter() },
    );

    expect(payload.daily_clock_hours[0]).toEqual({ date: "2026-08-05", hours: 8 });
    expect(payload.paid_period_hours[0]).toEqual({
      period_key: "2026-08-P1",
      paid_flag_hours: 18,
    });
  });
});
