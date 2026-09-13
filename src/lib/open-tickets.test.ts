// Open Tickets, Phase 1 — the arithmetic the plan locked, pinned.
//
// Every test here maps to a numbered decision in
// docs/plans/PLAN-open-tickets.md, or to a risk it named. The stats layer is
// exercised THROUGH its public functions with real rows, not by mocking the
// helpers, because the failure this feature guards against is a surface
// quietly disagreeing with another about what a worked day is.
import { describe, it, expect } from "vitest";
import {
  closePrefill,
  daysOpen,
  defaultPrefillLineIndex,
  eventLabel,
  isReopened,
  latestTransition,
  openWorkByDate,
  openWorkDates,
  openedOn,
  summarizeOpenTickets,
} from "./open-tickets";
import {
  aggregateStats,
  aggregateStatsWithSchedule,
  dailyDenominators,
  withOpenWorkDays,
  type ScheduleContext,
} from "./stats";
import { flagHoursByDate, inferWorkedWeekdays, recentDailyAverage } from "./forecast";
import { buildUnpaidSummary } from "./unpaid-summary";
import { buildImportPayload, type ImportBundle } from "./import-remap";
import { emptyWeek, type WorkSchedule } from "./schedule";
import { closeTicketSchema, addRoEventSchema } from "./validation/actions";
import { check } from "./validation/core";
import type { Entry, RoEvent, UnpaidTime } from "./types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let seq = 0;
function entry(
  date: string,
  flagHours: number,
  extra: Partial<Entry> = {},
): Entry {
  return {
    id: `e-${++seq}`,
    userId: "u",
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
    date,
    roNumber: "12345",
    vehicle: { year: "", make: "", model: "", vin: "", mileage: "" },
    opCodes: [],
    flagHours,
    notes: "",
    status: "closed",
    ...extra,
  };
}

function row(
  date: string,
  hours: number,
  kind: UnpaidTime["kind"],
  extra: Partial<UnpaidTime> = {},
): UnpaidTime {
  return {
    id: `u-${++seq}`,
    userId: "u",
    date,
    hours,
    kind,
    entryId: null,
    originalEntryId: null,
    source: "manual",
    note: "",
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
    ...extra,
  };
}

function event(
  entryId: string,
  date: string,
  kind: RoEvent["kind"],
  extra: Partial<RoEvent> = {},
): RoEvent {
  return {
    id: `ev-${++seq}`,
    userId: "u",
    entryId,
    date,
    time: null,
    kind,
    note: "",
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
    ...extra,
  };
}

// Mon 2026-06-08 .. Fri 2026-06-12 is a known week (periods.test.ts).
const MON = "2026-06-08";
const TUE = "2026-06-09";
const WED = "2026-06-10";
const THU = "2026-06-11";
const FRI = "2026-06-12";

// ── Decision 7 — a day with open-ticket hours is a worked day ──────────────

describe("flagHoursByDate seeds open_work days at 0 flag (decision 7)", () => {
  it("an intermediate day with only a ledger row is present in the map with 0", () => {
    const open = entry(MON, 0, { status: "open", id: "T1" });
    const ledger = [row(TUE, 8, "open_work", { entryId: "T1" })];
    const byDate = flagHoursByDate([open], MON, FRI, ledger);
    expect([...byDate.keys()].sort()).toEqual([MON, TUE]);
    expect(byDate.get(TUE)).toBe(0);
  });

  it("after close, the opened day loses its RO row and the ledger row keeps it worked", () => {
    // The ticket was opened Monday; on Friday it closed and its date moved.
    const closed = entry(FRI, 14, { id: "T1" });
    const ledger = [
      row(MON, 8, "open_work", { entryId: "T1" }),
      row(TUE, 2, "open_work", { entryId: "T1" }),
    ];
    const byDate = flagHoursByDate([closed], MON, FRI, ledger);
    expect([...byDate.keys()].sort()).toEqual([MON, TUE, FRI]);
    expect(byDate.get(MON)).toBe(0);
    expect(byDate.get(FRI)).toBe(14);
  });

  it("a hold row does NOT make a day worked — only open_work does", () => {
    const byDate = flagHoursByDate([], MON, FRI, [row(WED, 3, "wait_parts")]);
    expect(byDate.size).toBe(0);
  });

  it("is unchanged for callers that pass no ledger", () => {
    const byDate = flagHoursByDate([entry(MON, 4)], MON, FRI);
    expect([...byDate.entries()]).toEqual([[MON, 4]]);
  });
});

describe("schedule inference and the daily average see open-ticket days", () => {
  it("inferWorkedWeekdays picks up a weekday that only ever had open_work rows", () => {
    // Four Mondays of open work, nothing else. Without the ledger the set
    // would be empty and fall back to Mon–Fri; with it, Monday alone.
    const ledger = ["2026-05-18", "2026-05-25", "2026-06-01", MON].map((d) =>
      row(d, 8, "open_work"),
    );
    const worked = inferWorkedWeekdays([], {
      today: FRI,
      unpaid: ledger,
      fallbackToDefault: false,
    });
    expect([...worked]).toEqual([1]);
  });

  it("recentDailyAverage divides by the open-ticket days too — the average is lower, and honest", () => {
    // Five 8h days, then five days on an open ticket flagging nothing.
    const entries = [MON, TUE, WED, THU, FRI].map((d) => entry(d, 8));
    const ledger = ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"].map(
      (d) => row(d, 8, "open_work"),
    );
    const without = recentDailyAverage(entries, { today: "2026-06-19" });
    const withLedger = recentDailyAverage(entries, { today: "2026-06-19", unpaid: ledger });
    expect(without).toBe(8);
    expect(withLedger).toBe(4);
  });
});

// ── aggregateStats — the buckets ───────────────────────────────────────────

describe("aggregateStats with open tickets", () => {
  const range = { start: MON, end: FRI };

  it("an open row reports 0 flag and still counts as an RO (plan risk #2)", () => {
    const open = entry(TUE, 0, { status: "open" });
    const s = aggregateStats([open], [], range);
    expect(s.flagHours).toBe(0);
    expect(s.roCount).toBe(1);
  });

  it("open_work lands in openTicketHours and NOWHERE else (decision 10)", () => {
    const ledger = [
      row(MON, 8, "open_work", { entryId: "T1" }),
      row(TUE, 2.5, "open_work", { entryId: "T1" }),
      row(TUE, 1, "wait_parts", { entryId: "T1" }),
      row(WED, 4, "open_work", { entryId: "T2" }),
    ];
    const s = aggregateStats([], [], range, ledger);
    expect(s.openTicketHours).toBe(14.5);
    expect(s.openTicketCount).toBe(2);
    // The hold row is still unpaid; the open work never is.
    expect(s.waitingHours).toBe(1);
    expect(s.unpaidHours).toBe(1);
    expect(s.comebackHours).toBe(0);
    expect(s.shopHours).toBe(0);
    expect(s.flagHours).toBe(0);
  });

  it("efficiency is computed from flag and clock exactly as before (decision 7)", () => {
    const ledger = [row(MON, 8, "open_work")];
    const s = aggregateStats([entry(MON, 4)], [{ userId: "u", date: MON, hours: 8 }], range, ledger);
    expect(s.efficiency).toBe(50);
  });
});

// ── The schedule side — no prompt, no held-out day ─────────────────────────

function monFriSchedule(): WorkSchedule {
  const week = emptyWeek();
  const shift = { start: "08:00", end: "17:00", breakMin: 60 };
  return {
    id: "S1",
    effectiveFrom: "2026-01-05",
    anchorMonday: "2026-01-05",
    rotationWeeks: 1,
    weeks: [{ ...week, mon: shift, tue: shift, wed: shift, thu: shift, fri: shift }],
    createdAt: "2026-01-05T00:00:00Z",
  } as unknown as WorkSchedule;
}

describe("a day on an open ticket is resolved, not asked about (decision 7)", () => {
  const ctx: ScheduleContext = {
    schedules: [monFriSchedule()],
    daysOff: [],
    confirmedZeroDays: [],
    today: "2026-06-15",
  };
  const range = { start: MON, end: FRI };

  it("without the ledger the empty day is unresolved; with it, it is counted", () => {
    const entries = [entry(MON, 8), entry(WED, 8), entry(THU, 8), entry(FRI, 8)];
    const before = aggregateStatsWithSchedule(entries, [], range, ctx);
    expect(before.unresolvedDays).toEqual([TUE]);

    const after = aggregateStatsWithSchedule(entries, [], range, ctx, [
      row(TUE, 8, "open_work"),
    ]);
    expect(after.unresolvedDays).toEqual([]);
    // Counted like a confirmed zero day: full scheduled length in the
    // denominator, nothing in the numerator. 32 / 40 = 80%.
    expect(after.denomHours).toBe(40);
    expect(after.efficiency).toBe(80);
  });

  it("dailyDenominators pairs the same day the same way", () => {
    const without = dailyDenominators([], [], range, ctx.today, ctx);
    expect(without[TUE]).toBeUndefined();
    const withLedger = dailyDenominators([], [], range, ctx.today, ctx, [row(TUE, 8, "open_work")]);
    expect(withLedger[TUE]).toEqual({ hours: 8, source: "scheduled" });
  });

  it("withOpenWorkDays folds only in-range open_work dates, and returns the same ctx when there are none", () => {
    expect(withOpenWorkDays(ctx, [row(TUE, 1, "wait_parts")], range)).toBe(ctx);
    const folded = withOpenWorkDays(
      ctx,
      [row(TUE, 8, "open_work"), row("2026-07-01", 8, "open_work")],
      range,
    );
    expect(folded.confirmedZeroDays).toEqual([TUE]);
  });
});

// ── The unpaid surfaces never see open work (decision 10) ──────────────────

describe("buildUnpaidSummary excludes open_work", () => {
  it("a ticket's open_work rows are not lines, not hours, not byKind", () => {
    const s = buildUnpaidSummary({
      entries: [],
      unpaid: [row(MON, 8, "open_work"), row(MON, 1, "wait_approval")],
    });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].kind).toBe("wait_approval");
    expect(s.totalHours).toBe(1);
    expect(s.byKind.open_work).toBe(0);
  });
});

// ── Pure helpers ───────────────────────────────────────────────────────────

describe("openWorkDates / openWorkByDate", () => {
  const ledger = [
    row(MON, 8, "open_work", { entryId: "T1" }),
    row(MON, 1, "open_work", { entryId: "T2" }),
    row(TUE, 2, "wait_parts", { entryId: "T1" }),
    row("2026-07-01", 3, "open_work", { entryId: "T1" }),
  ];
  it("dates are range-clipped and kind-filtered", () => {
    expect([...openWorkDates(ledger, MON, FRI)]).toEqual([MON]);
  });
  it("per-day hours and DISTINCT ticket count", () => {
    const by = openWorkByDate(ledger, MON, FRI);
    expect(by.get(MON)).toEqual({ hours: 9, tickets: 2 });
    expect(by.has(TUE)).toBe(false);
  });
});

describe("closePrefill (decision 6)", () => {
  it("sums open_work only, and hold time is reported as excluded", () => {
    const p = closePrefill(
      [
        row(MON, 8, "open_work", { entryId: "T1" }),
        row(TUE, 6.5, "open_work", { entryId: "T1" }),
        row(TUE, 2, "wait_parts", { entryId: "T1" }),
        row(WED, 4, "open_work", { entryId: "OTHER" }),
      ],
      "T1",
    );
    expect(p.actualHours).toBe(14.5);
    expect(p.excludedHoldHours).toBe(2);
  });

  it("source is timer only when EVERY row was timer-written; mixed is an estimate", () => {
    const allTimer = closePrefill(
      [row(MON, 1, "open_work", { entryId: "T1", source: "timer" })],
      "T1",
    );
    expect(allTimer.actualSource).toBe("timer");
    const mixed = closePrefill(
      [
        row(MON, 1, "open_work", { entryId: "T1", source: "timer" }),
        row(TUE, 1, "open_work", { entryId: "T1", source: "manual" }),
      ],
      "T1",
    );
    expect(mixed.actualSource).toBe("estimate");
    expect(closePrefill([], "T1").actualSource).toBeNull();
  });

  it("defaults the prefill onto the largest flag line, first on a tie", () => {
    expect(defaultPrefillLineIndex([{ flagHours: 1 }, { flagHours: 6 }, { flagHours: 6 }])).toBe(1);
    expect(defaultPrefillLineIndex([{ flagHours: 2 }])).toBe(0);
  });
});

describe("the timeline side", () => {
  it("openedOn reads the opened event, never created_at or entries.date", () => {
    // Closed on Friday (date moved), opened Monday per the event, row written Tuesday.
    const e = entry(FRI, 14, { id: "T1", createdAt: `${TUE}T12:00:00Z` });
    const events = [event("T1", MON, "opened"), event("T1", FRI, "closed")];
    expect(openedOn(e, events)).toBe(MON);
    // No event at all → fall back to the row's date rather than crash.
    expect(openedOn(e, [])).toBe(FRI);
  });

  it("daysOpen is inclusive of the opened day", () => {
    expect(daysOpen(MON, MON)).toBe(1);
    expect(daysOpen(MON, FRI)).toBe(5);
    expect(daysOpen(FRI, MON)).toBe(1);
  });

  it("a custom event shows its note as its label", () => {
    expect(eventLabel(event("T1", MON, "custom", { note: "Claim #4471 filed" }))).toBe("Claim #4471 filed");
    expect(eventLabel(event("T1", MON, "custom"))).toBe("Custom");
    expect(eventLabel(event("T1", MON, "hold_parts"))).toBe("Waiting on parts");
  });

  it("isReopened / latestTransition (decision 11) look only at opened/closed/reopened, ignoring story events layered after them", () => {
    // Never closed at all.
    expect(latestTransition([event("T1", MON, "opened")])?.kind).toBe("opened");
    expect(isReopened([event("T1", MON, "opened")])).toBe(false);

    // Closed once, no reopen.
    const closedOnce = [event("T1", MON, "opened"), event("T1", TUE, "closed")];
    expect(latestTransition(closedOnce)?.kind).toBe("closed");
    expect(isReopened(closedOnce)).toBe(false);

    // Reopened after that close — a hand-picked story event after the
    // `reopened` transition must not hide it (it isn't a transition itself).
    const reopened = [
      ...closedOnce,
      event("T1", WED, "reopened"),
      event("T1", THU, "diag_done"),
    ];
    expect(latestTransition(reopened)?.kind).toBe("reopened");
    expect(isReopened(reopened)).toBe(true);

    // Closed a second time — no longer "reopened".
    const closedAgain = [...reopened, event("T1", FRI, "closed")];
    expect(latestTransition(closedAgain)?.kind).toBe("closed");
    expect(isReopened(closedAgain)).toBe(false);

    // No events at all.
    expect(latestTransition([])).toBeNull();
    expect(isReopened([])).toBe(false);
  });

  it("summarizeOpenTickets: latest event is the status, oldest-opened first, hours are the ticket's open_work", () => {
    const a = entry(WED, 0, { id: "A", status: "open", roNumber: "111", createdAt: `${WED}T09:00:00Z` });
    const b = entry(MON, 0, { id: "B", status: "open", roNumber: "222", createdAt: `${MON}T09:00:00Z` });
    const closed = entry(TUE, 3, { id: "C" });
    const events = new Map<string, RoEvent[]>([
      ["A", [event("A", WED, "opened")]],
      ["B", [event("B", MON, "opened"), event("B", TUE, "hold_approval")]],
    ]);
    const ledger = [
      row(MON, 8, "open_work", { entryId: "B" }),
      row(TUE, 2, "open_work", { entryId: "B" }),
      row(TUE, 1, "wait_approval", { entryId: "B" }),
      row(WED, 3, "open_work", { entryId: "A" }),
    ];
    const out = summarizeOpenTickets([a, b, closed], events, ledger, FRI);
    expect(out.map((t) => t.entry.id)).toEqual(["B", "A"]);
    expect(out[0].statusLabel).toBe("Waiting on approval");
    expect(out[0].daysOpen).toBe(5);
    expect(out[0].hours).toBe(10);
    expect(out[1].statusLabel).toBe("Opened");
    expect(out[1].hours).toBe(3);
  });
});

// ── Backup: v5 shape ───────────────────────────────────────────────────────

describe("import-remap v5", () => {
  const ts = "2026-01-01T00:00:00Z";
  function bundle(extra: Partial<ImportBundle>): ImportBundle {
    return {
      version: 5,
      exportedAt: ts,
      settings: { splitDay: 15, periodOverrides: {} },
      opCodes: [],
      dailyClocks: [],
      paidPeriods: [],
      entries: [
        entry(MON, 0, { id: "E1", status: "open", createdAt: ts, updatedAt: ts }),
        // A pre-v5 row: no status key at all.
        (() => {
          const e = entry(TUE, 2, { id: "E2", createdAt: ts, updatedAt: ts });
          delete (e as { status?: unknown }).status;
          return e;
        })(),
      ],
      ...extra,
    };
  }

  it("carries status, and fills 'closed' for a row that never had one", () => {
    const p = buildImportPayload(bundle({}), { newId: () => "NEW" });
    const byRo = new Map(p.entries.map((r) => [r.date, r.status]));
    expect(byRo.get(MON)).toBe("open");
    expect(byRo.get(TUE)).toBe("closed");
  });

  it("remaps ro_events onto the new entry id, drops one whose ticket is not in the file, and omits the key when absent", () => {
    let n = 0;
    const p = buildImportPayload(
      bundle({
        roEvents: [
          event("E1", MON, "opened", { createdAt: ts, updatedAt: ts }),
          event("GONE", MON, "opened", { createdAt: ts, updatedAt: ts }),
        ],
      }),
      { newId: () => `id-${++n}` },
    );
    expect(p.ro_events).toHaveLength(1);
    const e1 = p.entries.find((r) => r.date === MON)!;
    expect(p.ro_events![0].entry_id).toBe(e1.id);
    expect(p.ro_events![0]).toMatchObject({ date: MON, kind: "opened", note: "", time: null });

    const none = buildImportPayload(bundle({}), { newId: () => "NEW" });
    expect(none.ro_events).toBeUndefined();
  });

  it("an open_work ledger row survives the restore filter", () => {
    const p = buildImportPayload(
      bundle({ unpaidTime: [row(MON, 8, "open_work", { entryId: "E1" })] }),
      { newId: () => "NEW" },
    );
    expect(p.unpaid_time).toHaveLength(1);
    expect(p.unpaid_time![0].kind).toBe("open_work");
  });
});

// ── Validation: where the "at least one op code" rule lives for a ticket ──

describe("validation", () => {
  const ID = "aaaaaaaa-0000-4000-8000-000000000001";

  it("closeTicketSchema refuses an empty line list — the close is where the guard belongs", () => {
    const res = check(closeTicketSchema, { entryId: ID, date: MON, opCodes: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/at least one op code/i);
  });

  it("addRoEventSchema refuses the transition kinds — only the actions write those", () => {
    for (const kind of ["opened", "closed", "reopened"]) {
      const res = check(addRoEventSchema, { entryId: ID, kind, date: MON });
      expect(res.ok, kind).toBe(false);
    }
    expect(check(addRoEventSchema, { entryId: ID, kind: "parts_ordered", date: MON }).ok).toBe(true);
  });
});
