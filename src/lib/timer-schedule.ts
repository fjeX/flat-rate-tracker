// Resolves each timer slot's auto-stop deadline from the work schedule.
//
// Kept separate from lib/timer.ts so the timer math stays free of schedule
// concepts: timer.ts knows "a segment stops accruing at capAt"; this module is
// the only place that knows capAt comes from the end of a shift.
//
// Pure — no I/O, no React. Callers pass the schedule data they already loaded.

import { isoDateInTz, isoDate } from "./periods";
import {
  shiftForDate,
  type ShiftOverrideMap,
  type WorkSchedule,
} from "./schedule";
import { autoStopCap, minutesFromHHMM, type TimerSlot } from "./timer";

export type TimerCapContext = {
  // Null when the schedule migration hasn't been applied or the tech has no
  // schedule — the flat MAX_SEGMENT_MS ceiling applies instead.
  schedules: WorkSchedule[] | null;
  shiftOverrides: ShiftOverrideMap;
  timeZone?: string;
};

/**
 * Auto-stop deadline (epoch ms) for one slot, or null when it isn't accruing.
 *
 * The shift is looked up for the local day the CURRENT SEGMENT started, not
 * today — a timer started at 4pm and read at 2am the next morning must be
 * measured against yesterday's shift, which is the whole case this guards.
 */
export function capForSlot(slot: TimerSlot, ctx: TimerCapContext): number | null {
  if (slot.startTime === null) return null;

  const startedOn = ctx.timeZone
    ? isoDateInTz(ctx.timeZone, new Date(slot.startTime))
    : isoDate(new Date(slot.startTime));

  const shift =
    ctx.schedules && ctx.schedules.length > 0
      ? shiftForDate(ctx.schedules, startedOn, ctx.shiftOverrides)
      : null;

  return autoStopCap(slot.startTime, minutesFromHHMM(shift?.end), ctx.timeZone);
}

/** Slot id → deadline, for rendering a whole list at once. */
export function capsForSlots(
  slots: TimerSlot[],
  ctx: TimerCapContext,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const s of slots) out[s.id] = capForSlot(s, ctx);
  return out;
}
