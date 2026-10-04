import { describe, it, expect } from "vitest";
import type { Entry, EntryOpCode, OpCode } from "@/lib/types";
import type { HistoryUrlState } from "@/lib/history-url";
import {
  CSV_COLUMNS,
  CSV_SCHEMA_VERSION,
  buildHistoryCsv,
  csvFilename,
  describeFilters,
} from "./csv-export";

const BOM = "﻿";
const NOW = new Date("2026-03-12T17:30:00.000Z");
const HEADER_AT = 8; // 8 provenance lines, then the header row
const FIRST_ROW = HEADER_AT + 1;

const LIBRARY = [
  { id: "oc1", code: "INJ-RR", description: "Replace injector", subOpCodes: [] },
] as unknown as OpCode[];

const FILTERS: HistoryUrlState = {
  range: "month",
  from: "2026-03-01",
  to: "2026-03-12",
  q: "",
  sort: "date",
  dir: "desc",
  bar: null,
};

const SPAN = { start: "2026-03-01", end: "2026-03-31" };

function line(over: Partial<EntryOpCode> = {}): EntryOpCode {
  return {
    id: "l1",
    opCodeId: "oc1",
    custom: false,
    customCode: null,
    customDescription: null,
    flagHours: 1.5,
    actualHours: null,
    notes: "",
    position: 0,
    subOpCodeId: null,
    laborType: null,
    ...over,
  };
}

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    userId: "u",
    createdAt: "2026-03-10T15:00:00Z",
    updatedAt: "2026-03-10T15:00:00Z",
    date: "2026-03-10",
    roNumber: "12345",
    vehicle: { year: "2019", make: "Toyota", model: "Camry", vin: "", mileage: "" },
    opCodes: [line()],
    flagHours: 1.5,
    notes: "",
    ...over,
  };
}

function csv(entries: Entry[], filters = FILTERS, span: { start: string; end: string } | null = SPAN) {
  return buildHistoryCsv({ entries, library: LIBRARY, filters, span, exportedAt: NOW });
}

/** Physical lines, minus the BOM and the trailing newline. */
function lines(text: string): string[] {
  return text.slice(BOM.length).replace(/\r\n$/, "").split("\r\n");
}

/** One column of a row whose cells contain no commas or quotes. */
function cell(row: string, name: (typeof CSV_COLUMNS)[number]): string {
  return row.split(",")[CSV_COLUMNS.indexOf(name)];
}

describe("buildHistoryCsv: file shape", () => {
  it("starts with a BOM, uses CRLF only, and ends with a CRLF", () => {
    const out = csv([entry()]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(out.endsWith("\r\n")).toBe(true);
    expect(out.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("writes provenance lines before the header row", () => {
    const l = lines(csv([entry(), entry({ id: "e2", opCodes: [] })]));
    expect(l.slice(0, HEADER_AT)).toEqual([
      "# Flat Rate Tracker — History export",
      `# schema: ${CSV_SCHEMA_VERSION}`,
      "# exported_at: 2026-03-12T17:30:00.000Z",
      "# filters: range=month; dates=2026-03-01..2026-03-31",
      "# rows: 2 data rows from 2 ROs",
      "# hours are flat-rate tenths (0.1 = 6 min)",
      "# date: the day the RO flags on; for status=open, the day it was opened (on close it becomes the day the flag pays)",
      "# actual_source: timer = a clock ran; estimate = a tapped estimate; blank with actual_hours = recorded before sources were tracked",
    ]);
    expect(l[HEADER_AT]).toBe(CSV_COLUMNS.join(","));
  });

  it("names the schema frt-csv/1", () => {
    expect(CSV_SCHEMA_VERSION).toBe("frt-csv/1");
  });
});

describe("one row per op-code line", () => {
  it("an RO with 3 lines is 3 rows, numbered in position order", () => {
    const e = entry({
      opCodes: [
        line({ id: "c", position: 2, flagHours: 0.3 }),
        line({ id: "a", position: 0, flagHours: 1 }),
        line({ id: "b", position: 1, flagHours: 2 }),
      ],
    });
    const rows = lines(csv([e])).slice(FIRST_ROW);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => cell(r, "line"))).toEqual(["1", "2", "3"]);
    expect(rows.map((r) => cell(r, "flag_hours"))).toEqual(["1.00", "2.00", "0.30"]);
  });

  it("an RO with no lines (open ticket) is one row with empty line columns", () => {
    const e = entry({ status: "open", opCodes: [], flagHours: 0, notes: "waiting on parts" });
    const rows = lines(csv([e])).slice(FIRST_ROW);
    expect(rows).toHaveLength(1);
    expect(rows[0].split(",")).toHaveLength(CSV_COLUMNS.length);
    expect(cell(rows[0], "status")).toBe("open");
    for (const name of ["line", "op_code", "labor_type", "flag_hours", "comeback", "upsell", "line_notes"] as const) {
      expect(cell(rows[0], name)).toBe("");
    }
    expect(cell(rows[0], "ro_notes")).toBe("waiting on parts");
  });
});

describe("cell semantics", () => {
  it("reads a null labor type as Customer Pay, an explicit untyped as Untyped", () => {
    const e = entry({
      opCodes: [
        line({ laborType: null }),
        line({ id: "w", position: 1, laborType: "warranty" }),
        line({ id: "u", position: 2, laborType: "untyped" }),
      ],
    });
    const rows = lines(csv([e])).slice(FIRST_ROW);
    expect(rows.map((r) => cell(r, "labor_type"))).toEqual(["Customer Pay", "Warranty", "Untyped"]);
  });

  it("resolves library codes and descriptions, and custom lines' own", () => {
    const e = entry({
      opCodes: [
        line(),
        line({ id: "c", position: 1, opCodeId: null, custom: true, customCode: "SHOP", customDescription: "Shop, supplies" }),
      ],
    });
    const [a, b] = lines(csv([e])).slice(FIRST_ROW);
    expect(a).toContain(',INJ-RR,Replace injector,');
    expect(b).toContain(',SHOP,"Shop, supplies",');
  });

  it("prints hours as plain decimals, blank when not recorded", () => {
    const e = entry({ opCodes: [line({ flagHours: 0.1, actualHours: 0.25, paidHours: null })] });
    const row = lines(csv([e]))[FIRST_ROW];
    expect(cell(row, "flag_hours")).toBe("0.10");
    expect(cell(row, "actual_hours")).toBe("0.25");
    expect(cell(row, "paid_hours")).toBe("");
  });

  it("flags comeback and upsell lines", () => {
    const e = entry({
      opCodes: [line({ isComeback: true, flagHours: 0 }), line({ id: "u", position: 1, isUpsell: true })],
    });
    const rows = lines(csv([e])).slice(FIRST_ROW);
    expect(rows.map((r) => cell(r, "comeback"))).toEqual(["yes", "no"]);
    expect(rows.map((r) => cell(r, "upsell"))).toEqual(["no", "yes"]);
  });

  it("dates are ISO and a missing status reads closed", () => {
    const row = lines(csv([entry()]))[FIRST_ROW];
    expect(cell(row, "date")).toBe("2026-03-10");
    expect(cell(row, "status")).toBe("closed");
  });
});

describe("escaping", () => {
  it("quotes fields with commas, quotes and newlines, doubling quotes (RFC 4180)", () => {
    const out = csv([entry({ notes: 'line one\nline "two", end' })]);
    expect(out).toContain('"line one\nline ""two"", end"');
  });

  it("neutralizes a formula-looking text cell with a leading apostrophe", () => {
    const e = entry({
      roNumber: '=HYPERLINK("http://x")',
      notes: "@SUM(A1)",
      opCodes: [
        line({ notes: "+1 call" }),
        line({ id: "b", position: 1, notes: "-note" }),
        line({ id: "t", position: 2, notes: "\tTab" }),
      ],
    });
    const out = csv([e]);
    expect(out).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(out).toContain("'@SUM(A1)");
    expect(out).toContain(",'+1 call,");
    expect(out).toContain(",'-note,");
    expect(out).toContain("'\tTab");
  });

  it("leaves numbers alone, including a leading minus", () => {
    const e = entry({ opCodes: [line({ flagHours: -0.5 })] });
    expect(lines(csv([e]))[FIRST_ROW]).toContain(",-0.50,");
  });
});

describe("describeFilters", () => {
  it("always names the range, even the default, and the dates it covers", () => {
    expect(describeFilters({ ...FILTERS, range: "period" }, { start: "2026-03-01", end: "2026-03-15" })).toBe(
      "range=period; dates=2026-03-01..2026-03-15",
    );
    expect(describeFilters({ ...FILTERS, range: "all" }, null)).toBe("range=all");
  });

  it("lists search, sort and bar in the URL's canonical order", () => {
    expect(
      describeFilters(
        { ...FILTERS, q: "INJ-RR", sort: "hours", dir: "asc", bar: { start: "2026-03-09", end: "2026-03-09" } },
        { start: "2026-03-09", end: "2026-03-09" },
      ),
    ).toBe("range=month; dates=2026-03-09..2026-03-09; q=INJ-RR; sort=hours; dir=asc; bar=2026-03-09_2026-03-09");
  });

  it("keeps a multi-line search on one provenance line", () => {
    expect(describeFilters({ ...FILTERS, q: "a\nb" }, null)).toBe("range=month; q=a b");
  });
});

describe("csvFilename", () => {
  it("is dated by the tech's own today", () => {
    expect(csvFilename("2026-03-12")).toBe("frt-history-2026-03-12.csv");
  });
});

describe("frt-csv/1 schema auditor items", () => {
  const LIB = [
    {
      id: "oc1",
      code: "LOF",
      description: "Oil change",
      subOpCodes: [{ id: "v1", opCodeId: "oc1", code: "LOF-SYN" }],
    },
  ] as unknown as OpCode[];
  const build = (entries: Entry[]) =>
    lines(buildHistoryCsv({ entries, library: LIB, filters: FILTERS, span: SPAN, exportedAt: NOW }));

  it("names the sub op code variant the tech picked", () => {
    const rows = build([entry({ opCodes: [line({ subOpCodeId: "v1" }), line({ id: "l2", position: 1 })] })]);
    expect(cell(rows[FIRST_ROW], "op_variant")).toBe("LOF-SYN");
    expect(cell(rows[FIRST_ROW + 1], "op_variant")).toBe("");
  });

  it("says whose comeback it is, on the comeback line only", () => {
    const rows = build([
      entry({
        comebackKind: "comeback_other",
        opCodes: [line({ isComeback: true, flagHours: 0 }), line({ id: "l2", position: 1 })],
      }),
    ]);
    expect(cell(rows[FIRST_ROW], "comeback_kind")).toBe("Another tech's work");
    expect(cell(rows[FIRST_ROW + 1], "comeback_kind")).toBe("");
  });
});
