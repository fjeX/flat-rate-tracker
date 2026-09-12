// Open Tickets — the pure helpers every surface shares.
//
// See docs/plans/PLAN-open-tickets.md. A multi-day RO is a PROCESS: the ticket
// exists from teardown day, its hours land per day in the unpaid_time ledger
// as `open_work` rows, its story lands in ro_events, and the flag pays on the
// close day. The functions here are the arithmetic the plan locked, written
// once so the dashboard card, the modal, the close flow and the stats layer
// cannot reach different answers from the same rows.
//
// No I/O, no dates from the clock: every "today" is an argument.

import type { ActualSource, Entry, RoEvent, UnpaidTime } from "./types";
import { OPEN_WORK_KIND, RO_EVENT_KIND_LABELS } from "./types";
import { addDays } from "./periods";

// ---------------------------------------------------------------------------
// Ledger side — the hours
// ---------------------------------------------------------------------------

/** The open-work rows only. Every other kind is genuinely unpaid time. */
export function openWorkRows(unpaid: UnpaidTime[]): UnpaidTime[] {
  return unpaid.filter((u) => u.kind === OPEN_WORK_KIND);
}

/**
 * The set of dates carrying ANY open-ticket hours inside [from, to].
 *
 * THIS is the second half of the worked-day rule (decision 7): a date is
 * worked iff an RO row is dated that day OR an open_work row is dated that day.
 * Both halves are needed — while open, the intermediate days have only ledger
 * rows; after close, the opened day LOSES its RO row (the date moved) and only
 * the ledger row keeps it worked.
 */
export function openWorkDates(
  unpaid: UnpaidTime[],
  from: string,
  to: string,
): Set<string> {
  const out = new Set<string>();
  for (const u of openWorkRows(unpaid)) {
    if (u.date < from || u.date > to) continue;
    out.add(u.date);
  }
  return out;
}

/** Hours on open tickets per date inside [from, to] — the day-card line. */
export function openWorkByDate(
  unpaid: UnpaidTime[],
  from: string,
  to: string,
): Map<string, { hours: number; tickets: number }> {
  const hours = new Map<string, number>();
  const tickets = new Map<string, Set<string>>();
  for (const u of openWorkRows(unpaid)) {
    if (u.date < from || u.date > to) continue;
    hours.set(u.date, (hours.get(u.date) ?? 0) + u.hours);
    // Count = DISTINCT entry_id among the day's rows. An orphaned row (its
    // ticket deleted) still has hours but no ticket to count; it is counted
    // under its own null so the hours are never shown as "on 0 tickets".
    const key = u.entryId ?? "";
    let set = tickets.get(u.date);
    if (!set) {
      set = new Set<string>();
      tickets.set(u.date, set);
    }
    set.add(key);
  }
  const out = new Map<string, { hours: number; tickets: number }>();
  for (const [date, h] of hours) {
    out.set(date, { hours: h, tickets: tickets.get(date)?.size ?? 0 });
  }
  return out;
}

/** Sum of a single ticket's open-work hours. Hold rows are NOT in this. */
export function ticketOpenWorkHours(
  unpaid: UnpaidTime[],
  entryId: string,
): number {
  return openWorkRows(unpaid)
    .filter((u) => u.entryId === entryId)
    .reduce((s, u) => s + u.hours, 0);
}

// ---------------------------------------------------------------------------
// Close flow — the actual-hours prefill
// ---------------------------------------------------------------------------

export type ClosePrefill = {
  /** Sum of the ticket's open_work rows, rounded to the ledger's hundredths. */
  actualHours: number;
  /**
   * `timer` only when EVERY contributing row was timer-written; a single typed
   * row makes the whole figure an estimate. True Time must never receive a
   * typed number dressed as a measurement. null when there are no rows at all —
   * nothing to prefill, and the line's actual stays unset.
   */
  actualSource: ActualSource | null;
  /** Hours on this ticket's hold rows, so the UI can say what it excluded. */
  excludedHoldHours: number;
};

export function closePrefill(unpaid: UnpaidTime[], entryId: string): ClosePrefill {
  const mine = unpaid.filter((u) => u.entryId === entryId);
  const work = mine.filter((u) => u.kind === OPEN_WORK_KIND);
  const hold = mine.filter(
    (u) => u.kind === "wait_parts" || u.kind === "wait_approval",
  );
  const total = Math.round(work.reduce((s, u) => s + u.hours, 0) * 100) / 100;
  const allTimer = work.length > 0 && work.every((u) => u.source === "timer");
  return {
    actualHours: total,
    actualSource: work.length === 0 ? null : allTimer ? "timer" : "estimate",
    excludedHoldHours:
      Math.round(hold.reduce((s, u) => s + u.hours, 0) * 100) / 100,
  };
}

/**
 * Which line the prefilled actual goes on when the close form carries more
 * than one: the largest flag-hours line, first one on a tie. The tech can
 * override it in the picker; this is only the default.
 */
export function defaultPrefillLineIndex(
  lines: { flagHours: number }[],
): number {
  let best = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].flagHours > lines[best].flagHours) best = i;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Timeline side — the story
// ---------------------------------------------------------------------------

/** The latest event IS the ticket's status (decision 5). Events must be
 *  chronological (db.sortRoEvents); the last one wins. */
export function latestEvent(events: RoEvent[]): RoEvent | null {
  return events.length > 0 ? events[events.length - 1] : null;
}

/** What the status chip reads. A custom event shows its note as the label. */
export function eventLabel(event: RoEvent): string {
  if (event.kind === "custom") {
    return event.note.trim() || RO_EVENT_KIND_LABELS.custom;
  }
  return RO_EVENT_KIND_LABELS[event.kind];
}

/**
 * The day the ticket was opened: the `opened` event's date, never created_at
 * (a ticket back-filled at 9pm was not opened at 9pm) and never entries.date
 * (which moves at close). Falls back to the entry's date only when the event
 * is missing — a row written before the action existed, or a bundle that lost
 * its timeline — so the card can still count.
 */
export function openedOn(entry: Entry, events: RoEvent[]): string {
  const opened = events.find((e) => e.kind === "opened");
  return opened?.date ?? entry.date;
}

/** Calendar days open, inclusive of the opened day: opened today = 1. */
export function daysOpen(openedDate: string, today: string): number {
  if (today < openedDate) return 1;
  let n = 1;
  let d = openedDate;
  // Bounded walk: a ticket cannot plausibly sit open for more than a couple of
  // years, and the loop must not hang on a malformed date.
  for (let i = 0; d < today && i < 2000; i++) {
    d = addDays(d, 1);
    n += 1;
  }
  return n;
}

export type OpenTicketSummary = {
  entry: Entry;
  openedOn: string;
  daysOpen: number;
  /** null when the ticket has no events at all (should not happen; see openedOn). */
  latest: RoEvent | null;
  statusLabel: string;
  hours: number;
};

/**
 * One row of the dashboard's Open Tickets card, per open entry, oldest-opened
 * first. Sorting is on the resolved opened day, then created_at, so two
 * tickets opened the same day keep a stable order.
 */
export function summarizeOpenTickets(
  entries: Entry[],
  eventsByEntry: Map<string, RoEvent[]>,
  unpaid: UnpaidTime[],
  today: string,
): OpenTicketSummary[] {
  return entries
    .filter((e) => e.status === "open")
    .map((entry) => {
      const events = eventsByEntry.get(entry.id) ?? [];
      const opened = openedOn(entry, events);
      const latest = latestEvent(events);
      return {
        entry,
        openedOn: opened,
        daysOpen: daysOpen(opened, today),
        latest,
        statusLabel: latest ? eventLabel(latest) : RO_EVENT_KIND_LABELS.opened,
        hours: ticketOpenWorkHours(unpaid, entry.id),
      };
    })
    .sort(
      (a, b) =>
        a.openedOn.localeCompare(b.openedOn) ||
        a.entry.createdAt.localeCompare(b.entry.createdAt),
    );
}
