import { describe, it, expect } from "vitest";
import { createEntry, updateEntry, getEntry, setLinePaidHours } from "./entries";
import type { DbClient } from "./_client";
import type { NewEntry } from "@/lib/types";

// ---------------------------------------------------------------------------
// Minimal in-memory fake of the slice of the Supabase query builder that the
// entries data layer uses. It is intentionally small: just enough to prove the
// diff-based updateEntry never wipes a line column an edit didn't carry.
//
// Supported per-call chains:
//   from("entries").insert(row).select().single()
//   from("entries").update(patch).eq("id", id)
//   from("entries").delete().eq("id", id)
//   from("entries").select("*, entry_op_codes(*)").eq("id", id).maybeSingle()
//   from("entry_op_codes").insert(rowOrRows)
//   from("entry_op_codes").select("id").eq("entry_id", id)
//   from("entry_op_codes").update(patch).eq("id", id)
//   from("entry_op_codes").delete().in("id", ids)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Filter = { kind: "eq" | "in"; col: string; val: unknown };

let idCounter = 0;
const nextId = () => `id-${++idCounter}`;

const ENTRY_DEFAULTS: Row = {
  flag_hours: 0,
  notes: "",
  vehicle_year: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_vin: "",
  vehicle_mileage: "",
  created_at: "2026-07-07T00:00:00Z",
  updated_at: "2026-07-07T00:00:00Z",
};

const LINE_DEFAULTS: Row = {
  op_code_id: null,
  custom: false,
  custom_code: null,
  custom_description: null,
  flag_hours: 0,
  actual_hours: null,
  notes: "",
  position: 0,
  sub_op_code_id: null,
  labor_type: null,
  paid_hours: null,
};

class FakeStore {
  entries: Row[] = [];
  entry_op_codes: Row[] = [];
}

class Builder implements PromiseLike<{ data: unknown; error: null }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: unknown;
  private patch: Row = {};
  private filters: Filter[] = [];
  private selectCols = "*";
  private returning = false;

  constructor(
    private store: FakeStore,
    private table: "entries" | "entry_op_codes",
  ) {}

  private rows() {
    return this.store[this.table];
  }

  private match(row: Row): boolean {
    return this.filters.every((f) =>
      f.kind === "eq"
        ? row[f.col] === f.val
        : Array.isArray(f.val) && f.val.includes(row[f.col]),
    );
  }

  insert(payload: unknown) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  select(cols = "*") {
    if (this.op === "insert" || this.op === "update") {
      this.returning = true;
    } else {
      this.op = "select";
    }
    this.selectCols = cols;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ kind: "eq", col, val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filters.push({ kind: "in", col, val });
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  single() {
    return this.run(true);
  }
  maybeSingle() {
    return this.run(true);
  }

  private hydrate(row: Row): Row {
    if (this.table !== "entries" || !this.selectCols.includes("entry_op_codes")) {
      return row;
    }
    return {
      ...row,
      entry_op_codes: this.store.entry_op_codes.filter(
        (l) => l.entry_id === row.id,
      ),
    };
  }

  private run(single = false): Promise<{ data: unknown; error: null }> {
    if (this.op === "insert") {
      const defaults = this.table === "entries" ? ENTRY_DEFAULTS : LINE_DEFAULTS;
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = (list as Row[]).map((r) => ({
        ...defaults,
        ...r,
        id: (r.id as string) ?? nextId(),
      }));
      this.rows().push(...inserted);
      const data = this.returning ? (single ? inserted[0] : inserted) : null;
      return Promise.resolve({ data, error: null });
    }
    if (this.op === "update") {
      for (const row of this.rows()) {
        if (this.match(row)) Object.assign(row, this.patch);
      }
      return Promise.resolve({ data: null, error: null });
    }
    if (this.op === "delete") {
      const kept = this.rows().filter((r) => !this.match(r));
      this.store[this.table] = kept;
      return Promise.resolve({ data: null, error: null });
    }
    // select
    const matched = this.rows().filter((r) => this.match(r)).map((r) => this.hydrate(r));
    const data = single ? (matched[0] ?? null) : matched;
    return Promise.resolve({ data, error: null });
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run(false).then(onfulfilled, onrejected);
  }
}

function makeFakeDb(store: FakeStore): DbClient {
  const client = {
    from(table: "entries" | "entry_op_codes") {
      return new Builder(store, table);
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
    },
  };
  return client as unknown as DbClient;
}

function newEntry(over: Partial<NewEntry> = {}): NewEntry {
  return {
    date: "2026-07-01",
    roNumber: "12345",
    vehicle: { year: "2018", make: "Toyota", model: "Camry", vin: "", mileage: "" },
    notes: "original notes",
    opCodes: [
      {
        opCodeId: "oc-1",
        custom: false,
        customCode: null,
        customDescription: null,
        flagHours: 2,
        actualHours: 2.5,
        notes: "",
        position: 0,
        subOpCodeId: null,
        laborType: null,
      },
    ],
    ...over,
  };
}

describe("updateEntry (diff-based line reconciliation)", () => {
  it("keeps actual_hours on a line when an unrelated field (notes) is edited", async () => {
    const store = new FakeStore();
    const supabase = makeFakeDb(store);

    const created = await createEntry(supabase, newEntry());
    const line = created.opCodes[0];
    expect(line.actualHours).toBe(2.5);

    // Edit ONLY the notes. The form re-sends the existing line, carrying its id
    // and its current values back through the patch.
    const updated = await updateEntry(supabase, created.id, {
      notes: "edited notes",
      opCodes: [
        {
          id: line.id,
          opCodeId: line.opCodeId,
          custom: line.custom,
          customCode: line.customCode,
          customDescription: line.customDescription,
          flagHours: line.flagHours,
          actualHours: line.actualHours,
          notes: line.notes,
          position: 0,
          subOpCodeId: line.subOpCodeId,
          laborType: line.laborType,
        },
      ],
    });

    expect(updated.notes).toBe("edited notes");
    expect(updated.opCodes).toHaveLength(1);
    expect(updated.opCodes[0].actualHours).toBe(2.5);
    // The line id is stable — the row was UPDATEd in place, not replaced.
    expect(updated.opCodes[0].id).toBe(line.id);
  });

  it("preserves a line column the form never carries (the class fix)", async () => {
    const store = new FakeStore();
    const supabase = makeFakeDb(store);

    const created = await createEntry(supabase, newEntry());
    const line = created.opCodes[0];

    // Simulate a future/timer-written column the log form doesn't round-trip.
    const stored = store.entry_op_codes.find((r) => r.id === line.id)!;
    stored.paid_hours = 3.1;

    await updateEntry(supabase, created.id, {
      notes: "edited again",
      opCodes: [
        {
          id: line.id,
          opCodeId: line.opCodeId,
          custom: line.custom,
          customCode: line.customCode,
          customDescription: line.customDescription,
          flagHours: line.flagHours,
          actualHours: line.actualHours,
          notes: line.notes,
          position: 0,
          subOpCodeId: line.subOpCodeId,
          laborType: line.laborType,
        },
      ],
    });

    // Under the old delete-and-reinsert this would be gone. The diff UPDATE only
    // touches form-owned columns, so paid_hours survives.
    const after = store.entry_op_codes.find((r) => r.id === line.id);
    expect(after).toBeDefined();
    expect(after!.paid_hours).toBe(3.1);
  });

  it("inserts new lines, updates kept lines, and deletes removed ones", async () => {
    const store = new FakeStore();
    const supabase = makeFakeDb(store);

    const created = await createEntry(
      supabase,
      newEntry({
        opCodes: [
          {
            opCodeId: "oc-1", custom: false, customCode: null, customDescription: null,
            flagHours: 2, actualHours: 2.5, notes: "", position: 0, subOpCodeId: null, laborType: null,
          },
          {
            opCodeId: "oc-2", custom: false, customCode: null, customDescription: null,
            flagHours: 1, actualHours: null, notes: "", position: 1, subOpCodeId: null, laborType: null,
          },
        ],
      }),
    );
    const [keep, drop] = created.opCodes;

    const updated = await updateEntry(supabase, created.id, {
      opCodes: [
        // keep + edit flagHours on the first line
        {
          id: keep.id, opCodeId: keep.opCodeId, custom: keep.custom,
          customCode: keep.customCode, customDescription: keep.customDescription,
          flagHours: 4, actualHours: keep.actualHours, notes: keep.notes,
          position: 0, subOpCodeId: keep.subOpCodeId, laborType: keep.laborType,
        },
        // brand new line (no id)
        {
          opCodeId: "oc-3", custom: false, customCode: null, customDescription: null,
          flagHours: 0.5, actualHours: null, notes: "", position: 1, subOpCodeId: null, laborType: null,
        },
      ],
    });

    expect(updated.opCodes).toHaveLength(2);
    const keptLine = updated.opCodes.find((l) => l.id === keep.id);
    expect(keptLine?.flagHours).toBe(4);
    expect(keptLine?.actualHours).toBe(2.5);
    // dropped line is gone
    expect(updated.opCodes.some((l) => l.id === drop.id)).toBe(false);
    // new line landed
    expect(updated.opCodes.some((l) => l.opCodeId === "oc-3")).toBe(true);
  });

  it("round-trips labor_type through create and a diff-based edit", async () => {
    const store = new FakeStore();
    const supabase = makeFakeDb(store);

    // Create with an explicit labor type on the line.
    const created = await createEntry(
      supabase,
      newEntry({
        opCodes: [
          {
            opCodeId: "oc-1", custom: false, customCode: null, customDescription: null,
            flagHours: 2, actualHours: null, notes: "", position: 0, subOpCodeId: null,
            laborType: "warranty",
          },
        ],
      }),
    );
    expect(created.opCodes[0].laborType).toBe("warranty");

    // Edit ONLY the notes — the line's labor type must survive the diff.
    const line = created.opCodes[0];
    const afterNotesEdit = await updateEntry(supabase, created.id, {
      notes: "edited",
      opCodes: [
        {
          id: line.id, opCodeId: line.opCodeId, custom: line.custom,
          customCode: line.customCode, customDescription: line.customDescription,
          flagHours: line.flagHours, actualHours: line.actualHours, notes: line.notes,
          position: 0, subOpCodeId: line.subOpCodeId, laborType: line.laborType,
        },
      ],
    });
    expect(afterNotesEdit.opCodes[0].laborType).toBe("warranty");

    // Now change the labor type itself and confirm the new value persists.
    const afterTypeChange = await updateEntry(supabase, created.id, {
      opCodes: [
        {
          id: line.id, opCodeId: line.opCodeId, custom: line.custom,
          customCode: line.customCode, customDescription: line.customDescription,
          flagHours: line.flagHours, actualHours: line.actualHours, notes: line.notes,
          position: 0, subOpCodeId: line.subOpCodeId, laborType: "internal",
        },
      ],
    });
    expect(afterTypeChange.opCodes[0].laborType).toBe("internal");
    expect(afterTypeChange.opCodes[0].id).toBe(line.id); // UPDATEd in place
  });

  it("keeps paid_hours through a full reconcile → form-edit round-trip", async () => {
    const store = new FakeStore();
    const supabase = makeFakeDb(store);

    const created = await createEntry(supabase, newEntry());
    const line = created.opCodes[0];
    expect(line.paidHours).toBeNull();

    // Reconcile: the pay-period UI records the shop paid 1.5h on this line.
    await setLinePaidHours(supabase, line.id, 1.5);
    const reconciled = await getEntry(supabase, created.id);
    expect(reconciled!.opCodes[0].paidHours).toBe(1.5);

    // Now the tech edits the RO in the log form (changes only the notes). The
    // form re-sends the line carrying paidHours back through the patch — exactly
    // what useLogRoForm does. paid_hours must survive.
    const rline = reconciled!.opCodes[0];
    const afterEdit = await updateEntry(supabase, created.id, {
      notes: "changed the vehicle notes",
      opCodes: [
        {
          id: rline.id, opCodeId: rline.opCodeId, custom: rline.custom,
          customCode: rline.customCode, customDescription: rline.customDescription,
          flagHours: rline.flagHours, actualHours: rline.actualHours, notes: rline.notes,
          position: 0, subOpCodeId: rline.subOpCodeId, laborType: rline.laborType,
          paidHours: rline.paidHours,
        },
      ],
    });
    expect(afterEdit.notes).toBe("changed the vehicle notes");
    expect(afterEdit.opCodes[0].paidHours).toBe(1.5);
    expect(afterEdit.opCodes[0].id).toBe(rline.id);
  });
});
