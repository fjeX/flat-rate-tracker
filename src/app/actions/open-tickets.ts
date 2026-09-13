"use server";

// Server actions for Open Tickets (Phase 1, manual path).
// See docs/plans/PLAN-open-tickets.md — every rule below cites its decision.
//
// RETURN { error } RATHER THAN THROWING for validation and for "no such row",
// the same contract entries.ts / unpaid-time.ts use: a thrown Error crossing
// the Server Actions boundary has its message replaced with a generic string
// plus a digest in a production build, so the real sentence never reaches the
// tech. DB failures still throw — the caller reports those.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { closePrefill, isReopened, latestTransition } from "@/lib/open-tickets";
import { hhmmInTz, isoDate, isoDateInTz } from "@/lib/periods";
import { observationsFromEntry } from "@/lib/true-time";
import { reportServerError } from "@/lib/report-error-server";
import { check, validate } from "@/lib/validation/core";
import {
  addOpenWorkSchema,
  addRoEventSchema,
  closeTicketSchema,
  entryIdSchema,
  openTicketSchema,
  roEventIdSchema,
  roNumberQuerySchema,
  unpaidTimeIdSchema,
} from "@/lib/validation/actions";
import type { Entry, RoEvent, UnpaidTime } from "@/lib/types";
import type { DbClient } from "@/lib/db";

// Every surface an open ticket touches. /dashboard is listed EXPLICITLY —
// revalidating "/" does not reach it (memory/reference_frt_stale_state_gotchas).
function revalidateOpenTicketScreens() {
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/log");
}

/** Today in the user's timezone — the same read saveTimerAction makes. */
async function todayInUserTz(): Promise<string> {
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value;
  return tz ? isoDateInTz(tz) : isoDate();
}

async function nowHhmmInUserTz(): Promise<string> {
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value ?? "";
  return hhmmInTz(tz);
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/**
 * Open tickets already carrying this RO number — the "RO 12345 is already
 * open" warning (plan risk #4: OPEN tickets only; a closed match is normal).
 */
export async function findOpenRoAction(roNumber: string): Promise<Entry[]> {
  const ro = validate(roNumberQuerySchema, roNumber).trim();
  if (!ro) return [];
  const supabase = await createClient();
  return db.findOpenEntriesByRoNumber(supabase, ro);
}

/**
 * Open a ticket (decision 1/2/9). Writes the entry with status 'open' and
 * date = today, then the `opened` timeline event dated today. The event is
 * written HERE, by the server, so it cannot be forgotten by a client and the
 * opened day survives the close-day date move.
 *
 * If the event write fails after the entry landed, the entry is removed —
 * an open ticket with no `opened` event has no opened day to count from.
 */
export async function createOpenEntryAction(input: {
  roNumber: string;
  vehicle?: Entry["vehicle"];
  notes?: string;
}): Promise<{ entry?: Entry; error?: string }> {
  const parsed = check(openTicketSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const clean = parsed.data;

  const supabase = await createClient();
  const today = await todayInUserTz();

  const entry = await db.createOpenEntry(supabase, {
    date: today,
    roNumber: clean.roNumber,
    vehicle: {
      year: clean.vehicle.year.trim(),
      make: clean.vehicle.make.trim(),
      model: clean.vehicle.model.trim(),
      vin: clean.vehicle.vin.trim().toUpperCase(),
      mileage: clean.vehicle.mileage.trim(),
    },
    notes: clean.notes.trim(),
  });

  try {
    await db.createRoEvent(supabase, {
      entryId: entry.id,
      date: today,
      kind: "opened",
    });
  } catch (err) {
    // Best-effort cleanup so an open ticket never exists without its opened
    // day — the same shape createEntry uses when its lines fail.
    await db.deleteEntry(supabase, entry.id);
    throw err;
  }

  revalidateOpenTicketScreens();
  return { entry };
}

/**
 * Edit the progressive fields of an OPEN ticket (decision 2): RO number,
 * vehicle, notes, and the logged time. No lines — those arrive at close
 * through closeTicketAction, which is where the "at least one op code" rule
 * belongs for a ticket. saveEntry cannot do this: its schema requires a line.
 */
export async function updateOpenEntryAction(input: {
  entryId: string;
  roNumber: string;
  vehicle?: Entry["vehicle"];
  notes?: string;
  loggedTime?: string | null;
}): Promise<{ entry?: Entry; error?: string }> {
  const id = validate(entryIdSchema, input.entryId);
  const parsed = check(openTicketSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const clean = parsed.data;

  const supabase = await createClient();
  const existing = await db.getEntry(supabase, id);
  if (!existing) return { error: "That ticket is no longer there." };
  if (existing.status !== "open") {
    return { error: "That ticket is closed — edit it as a normal RO." };
  }

  const entry = await db.updateEntry(supabase, id, {
    roNumber: clean.roNumber,
    vehicle: {
      year: clean.vehicle.year.trim(),
      make: clean.vehicle.make.trim(),
      model: clean.vehicle.model.trim(),
      vin: clean.vehicle.vin.trim().toUpperCase(),
      mileage: clean.vehicle.mileage.trim(),
    },
    notes: clean.notes.trim(),
    // Same absent-vs-null contract as saveEntry: undefined leaves the column
    // alone (the setting is off and the form never asked).
    ...(clean.loggedTime !== undefined ? { loggedTime: clean.loggedTime } : {}),
  });
  revalidateOpenTicketScreens();
  return { entry };
}

/**
 * Reopen a closed ticket (decision 11): closed by mistake, or a second
 * approved line came in. Lines, flag_hours and entries.date are untouched — a
 * reopen must never silently move paid hours off the day they were paid.
 *
 * Order, mirroring closeTicketAction's own rule and for the same reason:
 *   1. `reopened` event   2. status = open   — LAST.
 * A failure after step 1 leaves a closed ticket whose timeline already says
 * "reopened" — visible, and the idempotency check below reads that as done on
 * retry — rather than a ticket that silently reopened with no record of it.
 */
export async function reopenTicketAction(
  entryId: string,
): Promise<{ entry?: Entry; error?: string }> {
  const id = validate(entryIdSchema, entryId);
  const supabase = await createClient();
  const existing = await db.getEntry(supabase, id);
  if (!existing) return { error: "That ticket is no longer there." };
  if (existing.status !== "closed") {
    return { error: "That ticket is already open." };
  }

  const events = await db.listRoEvents(supabase, id);
  // The Reopen button only ever renders on a timeline (TicketTimeline), which
  // means at least one event — but a row imported or hand-edited before the
  // timeline existed could have none. That RO was never a ticket; it's a
  // normal closed RO and reopening it as one would invent a story it doesn't
  // have.
  if (events.length === 0) {
    return { error: "This RO was never a ticket — edit it as a normal RO." };
  }

  // Step 1 — the event. Retry-safe: skipped when the latest transition is
  // already `reopened` (a retry after this write landed but the status flip
  // below failed).
  if (!isReopened(events)) {
    await db.createRoEvent(supabase, {
      entryId: id,
      date: await todayInUserTz(),
      kind: "reopened",
    });
  }

  // Step 2 — status LAST.
  await db.setEntryStatus(supabase, id, "open");

  revalidateOpenTicketScreens();
  const fresh = await db.getEntry(supabase, id);
  return fresh ? { entry: fresh } : { error: "Ticket disappeared after reopen." };
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

export type TicketTimeline = {
  events: RoEvent[];
  /** Every ledger row on this ticket: open_work AND hold rows. */
  ledger: UnpaidTime[];
};

/** One ticket's story and hours, for the RO modal's Timeline section. */
export async function getTicketTimelineAction(
  entryId: string,
): Promise<TicketTimeline> {
  const id = validate(entryIdSchema, entryId);
  const supabase = await createClient();
  const [events, ledger] = await Promise.all([
    db.listRoEventsSafe(supabase, id),
    db.listUnpaidTimeForEntry(supabase, id),
  ]);
  return { events: events ?? [], ledger };
}

/** Add a hand-picked timeline event. `opened`/`closed`/`reopened` are refused
 *  by the schema — only the actions that perform those transitions write them. */
export async function addRoEventAction(input: {
  entryId: string;
  kind: string;
  date: string;
  time?: string | null;
  note?: string;
}): Promise<{ error?: string }> {
  const parsed = check(addRoEventSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const clean = parsed.data;
  const supabase = await createClient();
  await db.createRoEvent(supabase, {
    entryId: clean.entryId,
    kind: clean.kind,
    date: clean.date,
    time: clean.time,
    note: clean.note.trim(),
  });
  revalidateOpenTicketScreens();
  return {};
}

/**
 * Delete one hand-written event by id. The transition events (`opened`,
 * `closed`, `reopened`) are refused: they are the record of what the ticket
 * did, and the card counts days-open from `opened`.
 */
export async function deleteRoEventAction(
  id: string,
): Promise<{ error?: string }> {
  const parsed = check(roEventIdSchema, id);
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const deleted = await db.deleteRoEvent(supabase, parsed.data);
  if (!deleted) {
    return {
      error:
        "That event can't be removed — it's either already gone, or one of the ticket's own milestones (opened / closed), which stay. Reload the page to see the current timeline.",
    };
  }
  revalidateOpenTicketScreens();
  return {};
}

// ---------------------------------------------------------------------------
// The hours
// ---------------------------------------------------------------------------

/**
 * Add a day's hours to an open ticket (decision 3/4): one unpaid_time row,
 * kind `open_work`, source `manual`, entry_id set. The manual path is the
 * safety net for the day the phone stayed in the drawer; Phase 2 adds the
 * timer path, which writes the same row with source `timer`.
 */
export async function addOpenWorkAction(input: {
  entryId: string;
  date: string;
  hours: number;
  note?: string;
}): Promise<{ error?: string }> {
  const parsed = check(addOpenWorkSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const clean = parsed.data;
  const supabase = await createClient();
  await db.createUnpaidTime(supabase, {
    date: clean.date,
    hours: clean.hours,
    kind: "open_work",
    entryId: clean.entryId,
    source: "manual",
    note: clean.note.trim(),
  });
  revalidateOpenTicketScreens();
  return {};
}

/** Delete one open-work row by id — the ledger's own PK delete, reused. */
export async function deleteOpenWorkAction(
  id: string,
): Promise<{ error?: string }> {
  const parsed = check(unpaidTimeIdSchema, id);
  if (!parsed.ok) return { error: parsed.error };
  const supabase = await createClient();
  const deleted = await db.deleteUnpaidTime(supabase, parsed.data);
  if (!deleted) {
    return {
      error:
        "Those hours are no longer there — they may already have been deleted. Reload the page to see the current list.",
    };
  }
  revalidateOpenTicketScreens();
  return {};
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

/**
 * Everything the close form needs to open with the right defaults: today in
 * the user's timezone, the time default when the setting wants one, and the
 * actual-hours prefill from the ticket's open_work rows (decision 6).
 */
export async function getCloseDefaultsAction(entryId: string): Promise<{
  today: string;
  /** entries.date as it stands right now — the flag day a KEEP leaves alone. */
  currentDate: string;
  /**
   * True when the ticket's latest transition is `reopened` (decision 11):
   * this is a SECOND close, so the form must ask keep-or-move rather than
   * silently defaulting the date to today the way a first close does.
   */
  reopened: boolean;
  defaultLoggedTime: string;
  trackRoTime: boolean;
  prefill: ReturnType<typeof closePrefill>;
}> {
  const id = validate(entryIdSchema, entryId);
  const supabase = await createClient();
  const [settings, ledger, today, entry, events] = await Promise.all([
    db.getSettings(supabase),
    db.listUnpaidTimeForEntry(supabase, id),
    todayInUserTz(),
    db.getEntry(supabase, id),
    db.listRoEvents(supabase, id),
  ]);
  return {
    today,
    currentDate: entry?.date ?? today,
    reopened: isReopened(events),
    defaultLoggedTime: settings.trackRoTime ? await nowHhmmInUserTz() : "",
    trackRoTime: settings.trackRoTime,
    prefill: closePrefill(ledger, id),
  };
}

/**
 * Close the ticket (decision 6/9, and the ordering rule from the plan).
 *
 * One sequence, in this order, on purpose:
 *   1. lines inserted (first close) or patched (second close, decision 11) —
 *      the recompute trigger sets entries.flag_hours either way
 *   2. date moved       — to the close day; logged_time re-defaulted
 *   3. `closed` event   — dated the close day
 *   4. status = closed  — LAST
 *
 * A failure after step 1 leaves an OPEN ticket with lines on it, which the
 * modal shows and the tech can retry, rather than a closed ticket with no
 * lines and no flag. The status flip is the one write that removes the ticket
 * from the card, so it is the one write that must come after everything else.
 *
 * Refuses a ticket that is not open (a double-tap, a stale tab) rather than
 * appending a second set of lines to a closed RO.
 */
export async function closeTicketAction(input: {
  entryId: string;
  date: string;
  loggedTime?: string | null;
  opCodes: Parameters<typeof db.addEntryLines>[2];
}): Promise<{ entry?: Entry; error?: string }> {
  const parsed = check(closeTicketSchema, input);
  if (!parsed.ok) return { error: parsed.error };
  const clean = parsed.data;

  const supabase = await createClient();
  const existing = await db.getEntry(supabase, clean.entryId);
  if (!existing) return { error: "That ticket is no longer there." };
  if (existing.status !== "open") {
    return { error: "That ticket is already closed. Reload the page to see it." };
  }

  // Same server-side comeback normalisation as saveEntry: a comeback line
  // flags zero no matter what the form sent.
  const lines = clean.opCodes.map((l) =>
    l.isComeback ? { ...l, flagHours: 0 } : l,
  );

  // Fetched once, up front, and reused for both the line step and the event
  // step below — nothing this action does before either read can change it.
  const eventsAtStart = await db.listRoEvents(supabase, clean.entryId);
  // A SECOND close (decision 11, after a reopen) is what "already has lines"
  // is supposed to mean — but a RETRY of a FIRST close also has lines by the
  // time it retries (step 1 already landed), and that must still be a no-op,
  // not a re-patch. The timeline is what tells the two apart: only a ticket
  // whose latest transition is `reopened` is a genuine second close.
  const isSecondClose = isReopened(eventsAtStart);

  // Step 1 — lines. A FIRST close inserts (the ticket has none yet); a SECOND
  // close already has lines and the form sends the FULL set — existing lines,
  // edited, plus whatever new line the tech added for the second approved
  // line. Inserting again would duplicate the old lines; only a patch is
  // safe, so this reuses updateEntry's own diff (diffEntryLines) — the exact
  // reconciliation a normal RO edit uses to update-by-id, insert what's new,
  // delete what's gone — rather than reinventing it here.
  //
  // Retry note: a retry after a step-2/3/4 failure on a FIRST close sees
  // isSecondClose === false and opCodes.length > 0, and correctly skips the
  // insert. A retry on a SECOND close re-runs the patch, which is idempotent
  // for every line that already carries an id (the diff updates it in place)
  // — the one gap is a brand new, id-less line, which a retry could insert
  // twice. That mirrors the same one-bulk-call assumption createEntry's own
  // line insert makes; closing this gap needs an idempotency key the schema
  // doesn't have yet.
  if (isSecondClose) {
    await db.updateEntry(supabase, clean.entryId, { opCodes: lines });
  } else if (existing.opCodes.length === 0) {
    await db.addEntryLines(supabase, clean.entryId, lines);
  }

  // Step 2 — the flag day. `undefined` loggedTime means the setting is off and
  // the form never asked: clear the opened-day time (plan risk #3) rather than
  // leave it describing a time on the wrong day.
  await db.setEntryCloseDate(
    supabase,
    clean.entryId,
    clean.date,
    clean.loggedTime ?? null,
  );

  // Step 3 — the event. Skipped only when the latest TRANSITION is already
  // `closed` — a retry that already wrote it. Checking "does ANY closed event
  // exist" would be wrong: a SECOND close (after a reopen) already has one
  // from the first close and must still record its own, or the timeline would
  // read as reopened-forever.
  const events = await db.listRoEvents(supabase, clean.entryId);
  if (latestTransition(events)?.kind !== "closed") {
    await db.createRoEvent(supabase, {
      entryId: clean.entryId,
      date: clean.date,
      kind: "closed",
    });
  }

  // Step 4 — LAST.
  await db.setEntryStatus(supabase, clean.entryId, "closed");

  await syncObservations(supabase, clean.entryId);
  revalidateOpenTicketScreens();

  const fresh = await db.getEntry(supabase, clean.entryId);
  return fresh ? { entry: fresh } : { error: "Ticket disappeared after close." };
}

// Same best-effort True Time hook entries.ts runs after every line mutation.
// Copied rather than imported: entries.ts keeps it module-private, and a
// "use server" file can only export async functions.
async function syncObservations(
  supabase: DbClient,
  entryId: string,
): Promise<void> {
  try {
    const [settings, entry, library] = await Promise.all([
      db.getSettings(supabase),
      db.getEntry(supabase, entryId),
      db.listOpCodes(supabase),
    ]);
    if (!entry) return;
    await db.syncEntryLaborTimeObservations(
      supabase,
      entryId,
      observationsFromEntry(entry, library),
      settings.shareLaborTimes,
    );
  } catch (err) {
    await reportServerError(err, { url: "true-time/syncObservations" });
  }
}
