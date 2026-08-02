"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import type { DbClient } from "@/lib/db";
import { isoDate, isoDateInTz } from "@/lib/periods";
import {
  bucketFor,
  flushAccumulators,
  HOLD_KIND,
  isTimerStatus,
  MAX_TIMER_SLOTS,
  msToHours,
  nextFreeSlot,
  type TimerSlot,
} from "@/lib/timer";
import { capForSlot, type TimerCapContext } from "@/lib/timer-schedule";

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
 * The same RO is deliberately refused on two slots at once: it's almost always
 * a mis-tap, and because saves are additive it would double-count the job's
 * actual hours in a way that's very hard to spot after the fact.
 */
export async function attachRoToTimerAction(
  entryId: string,
  lineId: string | null = null,
): Promise<void> {
  if (!entryId) throw new Error("Pick an RO first.");
  const supabase = await createClient();

  const entry = await db.getEntry(supabase, entryId);
  if (!entry) throw new Error("That RO no longer exists.");
  if (lineId && !entry.opCodes.some((l) => l.id === lineId)) {
    throw new Error("That op code line isn't on this RO.");
  }

  const all = await db.listTimerSlots(supabase);
  if (all.some((s) => s.entryId === entryId)) {
    throw new Error(`RO #${entry.roNumber} is already on a timer.`);
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
  timerId: string,
  status: string,
): Promise<void> {
  if (!isTimerStatus(status)) throw new Error("Unknown timer status.");
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
  revalidateTimerScreens();
}

/** Choose which op-code line a timer's work hours will land on. */
export async function setTimerLineAction(
  timerId: string,
  lineId: string | null,
): Promise<void> {
  const supabase = await createClient();
  const { slot } = await requireSlot(supabase, timerId);

  if (lineId) {
    if (!slot.entryId) throw new Error("This timer has no RO attached.");
    const entry = await db.getEntry(supabase, slot.entryId);
    if (!entry?.opCodes.some((l) => l.id === lineId)) {
      throw new Error("That op code line isn't on this RO.");
    }
  }

  await db.updateTimerSlot(supabase, slot.id, { lineId });
  revalidateTimerScreens();
}

/** Zero a timer's banked time but keep the slot and its RO. The clock restarts
 * from zero if the slot was accruing. */
export async function resetTimerAction(timerId: string): Promise<void> {
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
export async function releaseTimerAction(timerId: string): Promise<void> {
  const supabase = await createClient();
  const { slot } = await requireSlot(supabase, timerId);
  await db.deleteTimerSlot(supabase, slot.id);
  revalidateTimerScreens();
}

export type TimerSaveResult = {
  /** Hours added to the line (0 when the slot only ever waited). */
  workHours: number;
  /** The line's actual hours before this save — null when it was unmeasured. */
  previousHours: number | null;
  /** The line's actual hours after this save. */
  totalHours: number;
  waitPartsHours: number;
  waitApprovalHours: number;
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
  timerId: string,
  lineId: string,
): Promise<TimerSaveResult> {
  if (!lineId) throw new Error("Pick an op code to save this time to.");
  const supabase = await createClient();
  const { slot } = await requireSlot(supabase, timerId);

  if (!slot.entryId) throw new Error("This timer has no RO attached.");
  const entry = await db.getEntry(supabase, slot.entryId);
  if (!entry) throw new Error("That RO no longer exists.");
  if (!entry.opCodes.some((l) => l.id === lineId)) {
    throw new Error("That op code line isn't on this RO.");
  }

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
  if (workHours > 0) {
    const res = await db.addLineActualHours(supabase, lineId, workHours);
    previousHours = res.previous;
    totalHours = res.total;
  } else {
    const line = entry.opCodes.find((l) => l.id === lineId);
    previousHours = line?.actualHours ?? null;
    totalHours = previousHours ?? 0;
  }

  // Each hold reason writes its own row so the ledger can say WHY the time was
  // lost — a lumped row would make the dispute-pack line meaningless.
  let ledgerWritten = true;
  const waits = [
    { key: "holdParts" as const, hours: waitPartsHours },
    { key: "holdApproval" as const, hours: waitApprovalHours },
  ];
  for (const w of waits) {
    if (w.hours <= 0) continue;
    const ok = await db.createUnpaidTimeSafe(supabase, {
      date: ledgerDate,
      hours: w.hours,
      kind: HOLD_KIND[w.key],
      entryId: slot.entryId,
      source: "timer",
    });
    if (!ok) ledgerWritten = false;
  }

  await db.deleteTimerSlot(supabase, slot.id);
  revalidateAfterSave();

  return {
    workHours,
    previousHours,
    totalHours,
    waitPartsHours,
    waitApprovalHours,
    ledgerWritten,
  };
}
