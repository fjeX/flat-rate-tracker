"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { DbClient } from "@/lib/db";
import { isoDate, isoDateInTz } from "@/lib/periods";
import { openWorkRows, ticketOpenWorkHours } from "@/lib/open-tickets";
import { reportServerError } from "@/lib/report-error-server";
import {
  bucketFor,
  flushAccumulators,
  HOLD_KIND,
  isLedgerableHold,
  MAX_TIMER_SLOTS,
  msToHours,
  nextFreeSlot,
  type TimerSlot,
  attachConflict,
  lineTakenByOtherSlot,
} from "@/lib/timer";
import { capForSlot, type TimerCapContext } from "@/lib/timer-schedule";
import { validate } from "@/lib/validation/core";
import {
  attachTimerSchema,
  saveTimerSchema,
  timerIdSchema,
  timerLineSchema,
  timerStatusSchema,
} from "@/lib/validation/actions";

// Timer state lives in `active_timers` — one row per slot, up to 3 concurrent
// jobs. Every action here is slot-scoped: acting on one timer must never touch
// another's clock, which the old single-row model couldn't promise.
//
// The one cross-slot rule: only ONE slot may be `working` at a time. You have
// one pair of hands, so letting two slots bank working hours simultaneously
// would let an 8-hour day report 16 productive hours and quietly poison
// efficiency and book-time data. Holds are exempt — two cars really can both
// sit waiting on parts.

function revalidateTimerScreens() {
  // The nav's pulsing dot is driven by timer rows loaded in the app layout, so
  // the layout tree gets revalidated too. "/" is the marketing landing page —
  // the app dashboard is "/dashboard" and must be listed separately.
  revalidatePath("/timer");
  revalidatePath("/dashboard");
  revalidatePath("/", "layout");
}

// A save writes real hours onto an RO line (and possibly the unpaid ledger), so
// every surface that aggregates hours has to re-read.
function revalidateAfterSave() {
  revalidateTimerScreens();
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/insights");
  revalidatePath("/");
}

async function loadCapContext(supabase: DbClient): Promise<TimerCapContext> {
  const cookieStore = await cookies();
  const [schedules, shiftOverrides] = await Promise.all([
    db.listWorkSchedulesSafe(supabase),
    db.listShiftOverridesSafe(supabase),
  ]);
  return {
    schedules,
    shiftOverrides: shiftOverrides ?? {},
    timeZone: cookieStore.get("frt_timezone")?.value,
  };
}

async function requireSlot(
  supabase: DbClient,
  timerId: string,
): Promise<{ slot: TimerSlot; all: TimerSlot[] }> {
  const all = await db.listTimerSlots(supabase);
  const slot = all.find((s) => s.id === timerId);
  // RLS already scopes the read to this user, so "not found" covers both a
  // deleted timer and someone else's id.
  if (!slot) throw new Error("That timer is no longer running.");
  return { slot, all };
}

/** Bank whatever a slot has earned so far and stop its clock, without losing
 * the reason it was earned under. Shared by pause and by the auto-flip. */
async function bankAndPause(
  supabase: DbClient,
  slot: TimerSlot,
  now: number,
  ctx: TimerCapContext,
): Promise<void> {
  await db.updateTimerSlot(supabase, slot.id, {
    ...flushAccumulators(slot, now, capForSlot(slot, ctx)),
    status: "paused",
    startTime: null,
  });
}

/** Enforce the one-working-slot rule. Any other slot that was working gets
 * banked and paused — deliberately NOT flipped to a hold reason, since that
 * would invent a reason the tech never gave. */
async function pauseOtherWorkingSlots(
  supabase: DbClient,
  all: TimerSlot[],
  exceptId: string,
  now: number,
  ctx: TimerCapContext,
): Promise<void> {
  const others = all.filter((s) => s.id !== exceptId && s.status === "working");
  await Promise.all(others.map((s) => bankAndPause(supabase, s, now, ctx)));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Put an RO on a timer and start working it. Claims the lowest free slot.
 *
 * What is refused is the same LINE on two slots at once, not the same RO. Hours
 * bank per line (`addLineActualHours` writes one entry_op_codes row keyed on
 * lineId), so two slots on two different lines of one RO cannot double-count
 * anything — while an RO with a line on parts hold and another being diagnosed
 * is an ordinary afternoon. This used to refuse by entryId, which blocked that
 * outright and, worse, did it silently: the picker simply omitted the RO, so
 * the tech went looking for a job that had vanished (timer-same-ro-implicit-
 * refusal, 2026-08-13).
 *
 * A second timer on an already-running RO must name its line up front. Left
 * null it could later be pointed at the line already in flight, which is the
 * double-count the original guard was actually there to prevent.
 */
export async function attachRoToTimerAction(
  entryIdArg: string,
  lineIdArg: string | null = null,
): Promise<void> {
  const { entryId, lineId } = validate(attachTimerSchema, {
    entryId: entryIdArg,
    lineId: lineIdArg,
  });
  const supabase = await createClient();

  const entry = await db.getEntry(supabase, entryId);
  if (!entry) throw new Error("That RO no longer exists.");
  if (lineId && !entry.opCodes.some((l) => l.id === lineId)) {
    throw new Error("That op code line isn't on this RO.");
  }

  const all = await db.listTimerSlots(supabase);
  const conflict = attachConflict(all, entryId, lineId);
  // An open, lineless ticket (Open Tickets Phase 2) has no lines to name —
  // attachConflict still reports "needs-line" because lineId is null and the
  // RO is already on a slot, but there is no line picker to send the tech to.
  // Special-cased here rather than in attachConflict itself: that function is
  // shared with the guest store and knows nothing about entry.opCodes.
  if (conflict === "needs-line" && entry.opCodes.length === 0) {
    throw new Error(`RO #${entry.roNumber} is already on a timer.`);
  }
  switch (conflict) {
    case "needs-line":
      throw new Error(
        `RO #${entry.roNumber} is already on a timer. Pick which line this ` +
          `timer is for.`,
      );
    case "line-taken":
      throw new Error(`That line of RO #${entry.roNumber} is already on a timer.`);
    case "sibling-unassigned":
      throw new Error(
        `RO #${entry.roNumber} is on a timer that hasn't been assigned a line ` +
          `yet. Set that timer's line first.`,
      );
  }

  const slot = nextFreeSlot(all);
  if (slot === null) {
    throw new Error(
      `All ${MAX_TIMER_SLOTS} timers are in use. Save or clear one first.`,
    );
  }

  const now = Date.now();
  const ctx = await loadCapContext(supabase);
  await pauseOtherWorkingSlots(supabase, all, "", now, ctx);

  await db.createTimerSlot(supabase, {
    slot,
    entryId,
    lineId,
    status: "working",
    startTime: now,
  });
  revalidateTimerScreens();
}

/**
 * Change what a timer is doing. Banks the in-flight segment into the bucket it
 * was earned under, then restarts the clock under the new status (or stops it,
 * for `paused`).
 */
export async function setTimerStatusAction(
  timerIdArg: string,
  statusArg: string,
): Promise<void> {
  const { timerId, status } = validate(timerStatusSchema, {
    timerId: timerIdArg,
    status: statusArg,
  });
  const supabase = await createClient();
  const { slot, all } = await requireSlot(supabase, timerId);

  const now = Date.now();
  const ctx = await loadCapContext(supabase);

  if (status === "working") {
    await pauseOtherWorkingSlots(supabase, all, slot.id, now, ctx);
  }

  await db.updateTimerSlot(supabase, slot.id, {
    ...flushAccumulators(slot, now, capForSlot(slot, ctx)),
    status,
    // Paused banks nothing, so it carries no clock. Every other status does.
    startTime: bucketFor(status) === null ? null : now,
  });

  // Open Tickets Phase 2 (plan "Timer (Phase 2)", decision 5): a hold flip on
  // an open ticket writes a ro_events row of the same kind — the timeline is
  // the story, and "waiting on parts" starting is part of that story. Once per
  // flip, not per accrual tick, so the guard is "the status actually changed
  // TO a hold", not "the status IS a hold". Flipping back to working writes
  // nothing; the next real event tells that part of the story.
  //
  // Only fetch the entry when the new status is a hold, and only when it's
  // genuinely a change — a read on every flip (including working <-> paused,
  // which happens far more often) would be a query this feature doesn't need.
  const flippedToHold =
    (status === "hold_parts" || status === "hold_approval") &&
    slot.status !== status;
  if (flippedToHold && slot.entryId) {
    try {
      const entry = await db.getEntry(supabase, slot.entryId);
      if (entry?.status === "open") {
        const today = ctx.timeZone ? isoDateInTz(ctx.timeZone) : isoDate();
        await db.createRoEvent(supabase, {
          entryId: slot.entryId,
          date: today,
          kind: status,
        });
      }
    } catch (err) {
      // Best-effort: a failed event write must not fail the status change the
      // tech is actually waiting on.
      await reportServerError(err, { url: "timer/setTimerStatusAction" });
    }
  }

  revalidateTimerScreens();
}

/** Choose which op-code line a timer's work hours will land on. */
export async function setTimerLineAction(
  timerIdArg: string,
  lineIdArg: string | null,
): Promise<void> {
  const { timerId, lineId } = validate(timerLineSchema, {
    timerId: timerIdArg,
    lineId: lineIdArg,
  });
  const supabase = await createClient();
  const { slot } = await requireSlot(supabase, timerId);

  if (lineId) {
    if (!slot.entryId) throw new Error("This timer has no RO attached.");
    const entry = await db.getEntry(supabase, slot.entryId);
    if (!entry?.opCodes.some((l) => l.id === lineId)) {
      throw new Error("That op code line isn't on this RO.");
    }
    // Same rule as attach, enforced on the other door into it: now that one RO
    // may occupy several slots, re-pointing this timer at a line another slot
    // is already running would recreate exactly the additive double-count the
    // per-line guard exists to prevent.
    const all = await db.listTimerSlots(supabase);
    if (lineTakenByOtherSlot(all, slot.id, slot.entryId, lineId)) {
      throw new Error(
        `That line of RO #${entry.roNumber} is already on another timer.`,
      );
    }
  }

  await db.updateTimerSlot(supabase, slot.id, { lineId });
  revalidateTimerScreens();
}

/** Zero a timer's banked time but keep the slot and its RO. The clock restarts
 * from zero if the slot was accruing. */
export async function resetTimerAction(timerIdArg: string): Promise<void> {
  const timerId = validate(timerIdSchema, timerIdArg);
  const supabase = await createClient();
  const { slot } = await requireSlot(supabase, timerId);
  const accruing = bucketFor(slot.status) !== null;
  await db.updateTimerSlot(supabase, slot.id, {
    workAccumulated: 0,
    holdPartsAccumulated: 0,
    holdApprovalAccumulated: 0,
    startTime: accruing ? Date.now() : null,
  });
  revalidateTimerScreens();
}

/** Drop a timer entirely, discarding its time. The slot number frees up. */
export async function releaseTimerAction(timerIdArg: string): Promise<void> {
  const timerId = validate(timerIdSchema, timerIdArg);
  const supabase = await createClient();
  const { slot } = await requireSlot(supabase, timerId);
  await db.deleteTimerSlot(supabase, slot.id);
  revalidateTimerScreens();
}

export type TimerSaveResult = {
  /** Hours added to the line (0 when the slot only ever waited). */
  workHours: number;
  /**
   * The save's before-figure — a line's actual hours, or (Open Tickets Phase
   * 2) a ticket's open_work total — null when it was unmeasured/empty before
   * this save. Which one depends on `target`.
   */
  previousHours: number | null;
  /** The save's after-figure, same target as `previousHours`. */
  totalHours: number;
  /**
   * What the hours above describe: an op-code LINE (the original path), or an
   * open TICKET with no lines yet (Open Tickets Phase 2, decision 4/10). The
   * save modal and receipt need this to pick their wording — "that line" vs.
   * "that ticket" — and to know there is no line total to compare against.
   */
  target: "line" | "ticket";
  waitPartsHours: number;
  waitApprovalHours: number;
  /**
   * Whether an unpaid_time row was actually written for that hold.
   *
   * The rounded `hours` above cannot answer this: msToHours rounds to
   * hundredths, so 0.01h spans 18s–54s and MIN_LEDGERED_HOLD_MS (30s) sits
   * inside that band. A caller reading only the hours has to either claim a row
   * that may not exist or stay silent about one that does — and a genuine 40s
   * hold banked after the save modal froze its display then reached the ledger
   * with nobody told. Only this function knows, because it is where the gate is
   * applied; returning the answer costs a boolean.
   *
   * False also when the row was gated OUT and when the write itself failed:
   * both mean no row exists, which is what a consumer needs to know.
   */
  waitPartsLedgered: boolean;
  waitApprovalLedgered: boolean;
  /** False when the unpaid ledger couldn't be written (pre-migration VM). The
   * working hours still saved — they're the load-bearing half. */
  ledgerWritten: boolean;
};

/**
 * Finish a job: add the worked time to an op-code line, bank the waiting time
 * to the unpaid ledger, and release the slot.
 *
 * Hours are computed HERE from persisted state rather than accepted from the
 * client. The client's number is what a human eyeballed and approved, but the
 * server's is what actually happened — and only the server knows the auto-stop
 * cap, so a forgotten timer can't be saved at its face value.
 *
 * Work time is ADDED to the line, not replaced. Jobs span sessions (apart
 * Monday, waiting on a part overnight, finished Tuesday) and replacing meant
 * the second save silently discarded the first.
 */
export async function saveTimerAction(
  timerIdArg: string,
  lineIdArg: string | null,
): Promise<TimerSaveResult> {
  const { timerId, lineId } = validate(saveTimerSchema, {
    timerId: timerIdArg,
    lineId: lineIdArg,
  });
  const supabase = await createClient();
  const { slot } = await requireSlot(supabase, timerId);

  if (!slot.entryId) throw new Error("This timer has no RO attached.");
  const entry = await db.getEntry(supabase, slot.entryId);
  if (!entry) throw new Error("That RO no longer exists.");

  // Open Tickets Phase 2 (plan "Timer (Phase 2)", decisions 4/10): an open
  // ticket has no lines yet, so there is nothing for lineId to name — its
  // worked hours land on the TICKET instead, as an `open_work` ledger row.
  // Every entry that already has lines (open or closed) keeps the original
  // line contract, unchanged.
  const isOpenTicket = entry.status === "open" && entry.opCodes.length === 0;

  const now = Date.now();
  const ctx = await loadCapContext(supabase);
  const banked = flushAccumulators(slot, now, capForSlot(slot, ctx));

  const workHours = msToHours(banked.workAccumulated);
  const waitPartsHours = msToHours(banked.holdPartsAccumulated);
  const waitApprovalHours = msToHours(banked.holdApprovalAccumulated);

  // Attribute the time to the day it was earned, not the day it was saved —
  // otherwise a timer left running overnight lands its hours on tomorrow.
  const today = ctx.timeZone ? isoDateInTz(ctx.timeZone) : isoDate();
  const startedOn =
    slot.startTime !== null
      ? ctx.timeZone
        ? isoDateInTz(ctx.timeZone, new Date(slot.startTime))
        : isoDate(new Date(slot.startTime))
      : today;
  const ledgerDate = startedOn < today ? startedOn : today;

  let previousHours: number | null = null;
  let totalHours = 0;
  let target: "line" | "ticket";

  if (isOpenTicket) {
    // A lineId can only reach here if it was passed for a ticket that has no
    // lines to check it against — the same "isn't on this RO" refusal a bad
    // lineId gets on a lined entry, since there is no line, full stop.
    if (lineId !== null) {
      throw new Error("That op code line isn't on this RO.");
    }
    target = "ticket";

    // previousHours/totalHours here are the TICKET's open_work total, not a
    // line's — the save modal's running total and the divergence check both
    // read these fields regardless of which target they describe.
    const priorLedger = await db.listUnpaidTimeForEntry(supabase, slot.entryId);
    const priorWorkRows = openWorkRows(priorLedger);
    const priorTotal = ticketOpenWorkHours(priorLedger, slot.entryId);
    previousHours = priorWorkRows.length > 0 ? priorTotal : null;

    // The THROWING create, not createUnpaidTimeSafe: worked hours are the
    // load-bearing half of a save (see this function's own doc comment), so a
    // failure here must fail the save rather than silently drop real hours —
    // and it must do so BEFORE the slot is deleted, so the tech can retry.
    // No 30-second gate either (contrast the hold loop below): that gate
    // exists because a hold's value depends on being long enough to be worth
    // a dispute-pack line, but a worked minute banked here is real the moment
    // it lands.
    if (workHours > 0) {
      await db.createUnpaidTime(supabase, {
        date: ledgerDate,
        hours: workHours,
        kind: "open_work",
        entryId: slot.entryId,
        source: "timer",
      });
    }
    totalHours = priorTotal + (workHours > 0 ? workHours : 0);
  } else {
    if (lineId === null) {
      throw new Error("Pick an op code to save this time to.");
    }
    if (!entry.opCodes.some((l) => l.id === lineId)) {
      throw new Error("That op code line isn't on this RO.");
    }
    target = "line";

    if (workHours > 0) {
      const res = await db.addLineActualHours(supabase, lineId, workHours);
      previousHours = res.previous;
      totalHours = res.total;
    } else {
      const line = entry.opCodes.find((l) => l.id === lineId);
      previousHours = line?.actualHours ?? null;
      totalHours = previousHours ?? 0;
    }
  }

  // Each hold reason writes its own row so the ledger can say WHY the time was
  // lost — a lumped row would make the dispute-pack line meaningless.
  let ledgerWritten = true;
  const ledgered: Record<"holdParts" | "holdApproval", boolean> = {
    holdParts: false,
    holdApproval: false,
  };
  const waits = [
    {
      key: "holdParts" as const,
      hours: waitPartsHours,
      rawMs: banked.holdPartsAccumulated,
    },
    {
      key: "holdApproval" as const,
      hours: waitApprovalHours,
      rawMs: banked.holdApprovalAccumulated,
    },
  ];
  for (const w of waits) {
    // Gate on RAW ms, not on `hours`. `hours` is already rounded to hundredths
    // by msToHours, so a 20-second hold arrives here as 0.01 and clears a
    // `<= 0` test that plainly meant "no time was banked" — writing a permanent
    // row the save modal itself renders as "0m" onto the dispute pack. Each
    // entry carries its OWN rawMs because this loop is generic over both hold
    // kinds; testing one shared field here would break the other reason.
    //
    // No separate `hours <= 0` test: rawMs is non-negative (elapsedFor clamps
    // it) and rawMs >= 30_000 forces hours >= 0.01, so the old check is
    // strictly implied. Two thresholds that could drift apart is the bug we
    // just fixed, not a defence against it.
    if (!isLedgerableHold(w.rawMs)) continue;
    const ok = await db.createUnpaidTimeSafe(supabase, {
      date: ledgerDate,
      hours: w.hours,
      kind: HOLD_KIND[w.key],
      entryId: slot.entryId,
      source: "timer",
    });
    if (!ok) ledgerWritten = false;
    ledgered[w.key] = ok;
  }

  await db.deleteTimerSlot(supabase, slot.id);
  revalidateAfterSave();

  return {
    workHours,
    previousHours,
    totalHours,
    waitPartsHours,
    waitApprovalHours,
    waitPartsLedgered: ledgered.holdParts,
    waitApprovalLedgered: ledgered.holdApproval,
    ledgerWritten,
    target,
  };
}
