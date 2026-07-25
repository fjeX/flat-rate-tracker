// Pure timer math. No I/O, no React — everything is a plain function of a
// slot's persisted state plus `now`, so it's trivially unit-testable and safe
// from Server Components, client components, and tests alike. Mirrors the shape
// of lib/reconcile.ts and lib/wage-check.ts.
//
// The model: each slot has ONE clock (`startTime`) and THREE accumulators. The
// slot's `status` at the moment time accrues decides which accumulator that
// time lands in. Changing status banks the in-flight elapsed into the bucket it
// was earned under, then restarts the clock — so a job that was worked for two
// hours, sat waiting on parts for three, then waited on an approval for one
// reports 2.0 / 3.0 / 1.0, not 6.0 of anything.
//
// Why the two hold reasons get separate accumulators rather than one "hold"
// total: a lumped bucket would attribute the whole wait to whichever reason
// happened to be active at save time. Waiting on parts and waiting on an
// approval are different arguments to have with a service manager, and the
// point of this feature is that unpaid time stops being anonymous.

/** What a slot is doing right now. `paused` accrues nothing — it's also where a
 * slot lands when another slot starts working, because auto-assigning a hold
 * REASON the tech never gave would be inventing data. */
export type TimerStatus = "working" | "hold_parts" | "hold_approval" | "paused";

export const TIMER_STATUSES: readonly TimerStatus[] = [
  "working",
  "hold_parts",
  "hold_approval",
  "paused",
];

/** Hard cap on concurrent timers. Also enforced by the DB
 * (check slot between 1 and 3 + unique(user_id, slot)). */
export const MAX_TIMER_SLOTS = 3;

/** Which accumulator a status feeds. */
export type AccumulatorKey = "work" | "holdParts" | "holdApproval";

export type TimerSlot = {
  id: string;
  slot: number; // 1..MAX_TIMER_SLOTS
  entryId: string | null;
  lineId: string | null;
  status: TimerStatus;
  startTime: number | null; // epoch ms; null = clock not running
  workAccumulated: number; // ms banked while working
  holdPartsAccumulated: number; // ms banked while holding for parts
  holdApprovalAccumulated: number; // ms banked while holding for approval
};

export function isTimerStatus(v: unknown): v is TimerStatus {
  return typeof v === "string" && (TIMER_STATUSES as readonly string[]).includes(v);
}

/** Which accumulator a status feeds, or null when it feeds none. */
export function bucketFor(status: TimerStatus): AccumulatorKey | null {
  switch (status) {
    case "working":
      return "work";
    case "hold_parts":
      return "holdParts";
    case "hold_approval":
      return "holdApproval";
    default:
      return null;
  }
}

export function isHold(status: TimerStatus): boolean {
  const b = bucketFor(status);
  return b === "holdParts" || b === "holdApproval";
}

/** True when the slot's clock is actually banking time somewhere. A paused slot
 * with a non-null startTime is still not accruing — the status wins. */
export function isAccruing(slot: TimerSlot): boolean {
  return slot.startTime !== null && bucketFor(slot.status) !== null;
}

export type Elapsed = {
  work: number; // ms
  holdParts: number; // ms
  holdApproval: number; // ms
  hold: number; // holdParts + holdApproval
  total: number; // work + hold
};

/**
 * A slot's elapsed time as of `now`, including the segment still in flight.
 *
 * `capAt` optionally clamps the in-flight segment to an epoch-ms deadline —
 * that's the forgotten-timer guard (a timer left running overnight stops
 * counting at the end of the scheduled shift instead of billing 16 hours).
 * Passing null means no cap.
 */
export function elapsedFor(
  slot: TimerSlot,
  now: number,
  capAt: number | null = null,
): Elapsed {
  const banked = {
    work: Math.max(0, slot.workAccumulated),
    holdParts: Math.max(0, slot.holdPartsAccumulated),
    holdApproval: Math.max(0, slot.holdApprovalAccumulated),
  };

  const bucket = bucketFor(slot.status);
  if (slot.startTime !== null && bucket !== null) {
    // Clock skew (server/client disagreement, or a device whose clock moved
    // backwards) must never produce negative time.
    const until = capAt !== null ? Math.min(now, capAt) : now;
    banked[bucket] += Math.max(0, until - slot.startTime);
  }

  const hold = banked.holdParts + banked.holdApproval;
  return { ...banked, hold, total: banked.work + hold };
}

/**
 * Bank the in-flight segment into the accumulator it was earned under. Returns
 * the new accumulator triple — the caller decides what `startTime` and `status`
 * become next (a status change restarts the clock; a stop clears it).
 */
export function flushAccumulators(
  slot: TimerSlot,
  now: number,
  capAt: number | null = null,
): Pick<
  TimerSlot,
  "workAccumulated" | "holdPartsAccumulated" | "holdApprovalAccumulated"
> {
  const e = elapsedFor(slot, now, capAt);
  return {
    workAccumulated: e.work,
    holdPartsAccumulated: e.holdParts,
    holdApprovalAccumulated: e.holdApproval,
  };
}

/** Round ms to hundredths of an hour — `actual_hours` is numeric(5,2), and
 * `unpaid_time.hours` matches it. */
export function msToHours(ms: number): number {
  return Math.round((Math.max(0, ms) / 3_600_000) * 100) / 100;
}

/** HH:MM:SS for the big readout. Hours are not capped at 24 — a genuinely long
 * job should read 26:14:03, not roll over to 02:14:03. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Compact "2h 15m" / "45m" for secondary readouts where HH:MM:SS is noise. */
export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Lowest slot number not already taken, or null when all 3 are in use. */
export function nextFreeSlot(slots: TimerSlot[]): number | null {
  const taken = new Set(slots.map((s) => s.slot));
  for (let i = 1; i <= MAX_TIMER_SLOTS; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}

/** The slot currently working, if any. Only one may hold this at a time. */
export function workingSlot(slots: TimerSlot[]): TimerSlot | null {
  return slots.find((s) => s.status === "working") ?? null;
}

/** Any slot banking time right now — drives the nav's pulsing dot. */
export function anyAccruing(slots: TimerSlot[]): boolean {
  return slots.some(isAccruing);
}

// ---------------------------------------------------------------------------
// Display copy — shared by TimerView, TimerPip, and the guest mirror so the
// three can't drift apart the way their formatElapsed copies did.
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<TimerStatus, string> = {
  working: "Currently working",
  hold_parts: "Hold for parts",
  hold_approval: "Hold for approval",
  paused: "Paused",
};

/** Short form for the PiP and other tight spots. */
export const STATUS_LABEL_SHORT: Record<TimerStatus, string> = {
  working: "Working",
  hold_parts: "Parts",
  hold_approval: "Approval",
  paused: "Paused",
};

/** Badge tones. `--info` was defined in globals.css and unused until now, which
 * is why the two hold reasons don't have to share a colour. */
export const STATUS_TONE: Record<
  TimerStatus,
  "good" | "warn" | "info" | "neutral"
> = {
  working: "good",
  hold_parts: "warn",
  hold_approval: "info",
  paused: "neutral",
};

/** The unpaid_time.kind an accumulator becomes when its time is banked. */
export const HOLD_KIND: Record<
  "holdParts" | "holdApproval",
  "wait_parts" | "wait_approval"
> = {
  holdParts: "wait_parts",
  holdApproval: "wait_approval",
};

/** The unpaid_time.kind a hold status becomes. Null for statuses that produce
 * no ledger row. */
export function unpaidKindFor(
  status: TimerStatus,
): "wait_parts" | "wait_approval" | null {
  if (status === "hold_parts") return "wait_parts";
  if (status === "hold_approval") return "wait_approval";
  return null;
}

// ---------------------------------------------------------------------------
// Forgotten-timer guard
// ---------------------------------------------------------------------------
//
// A timer left running when you go home would otherwise bill 16 hours to a job
// and quietly wreck the period. The cap is derived from the schedule that
// already exists: a segment stops accruing at the end of the shift it started
// in, plus a grace window for staying late.
//
// The cap is computed as a DELTA from `startTime` rather than as an absolute
// wall-clock deadline. That's deliberate — turning a local "17:00" back into an
// epoch requires solving for the timezone's offset on that date (DST included),
// which is exactly the kind of math that produces a one-hour bug twice a year.
// Measuring forward from a known epoch needs only the local time-of-day at that
// epoch, which Intl gives directly.

/** Minutes past local midnight at `epochMs`, in `timeZone`. Falls back to the
 * runtime's own zone when none is given (and to UTC if the zone is bogus). */
export function localMinutesOfDay(epochMs: number, timeZone?: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(new Date(epochMs));
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    // Intl can render midnight as "24" in some locales/zones.
    return ((h % 24) * 60 + m) % 1440;
  } catch {
    const d = new Date(epochMs);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/** Grace after shift end before a running timer is capped. Staying 45 minutes
 * late to finish a job is normal; four hours late is a forgotten timer. */
export const AUTO_STOP_GRACE_MIN = 90;

/** Hard ceiling on a single accruing segment when no schedule applies. Long
 * enough that a genuine transmission job is never truncated. */
export const MAX_SEGMENT_MS = 12 * 3_600_000;

/**
 * Epoch-ms deadline past which a segment that began at `startTime` stops
 * accruing, or null when the slot isn't accruing at all.
 *
 * `shiftEndMin` is the shift's end as minutes past local midnight (from
 * ShiftDef.end); pass null when the day has no schedule, and the flat
 * MAX_SEGMENT_MS ceiling applies instead.
 */
export function autoStopCap(
  startTime: number | null,
  shiftEndMin: number | null,
  timeZone?: string,
): number | null {
  if (startTime === null) return null;
  const ceiling = startTime + MAX_SEGMENT_MS;
  if (shiftEndMin === null) return ceiling;

  const startMin = localMinutesOfDay(startTime, timeZone);
  const untilEnd = shiftEndMin - startMin;
  // Started at or after shift end (evening overtime, or a shift that already
  // ended): the schedule tells us nothing useful, so fall back to the ceiling.
  if (untilEnd <= 0) return ceiling;

  const capped = startTime + (untilEnd + AUTO_STOP_GRACE_MIN) * 60_000;
  return Math.min(capped, ceiling);
}

/** "HH:MM" → minutes past midnight. null for anything malformed. */
export function minutesFromHHMM(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** True when the cap actually bit — i.e. the slot is still marked accruing but
 * stopped banking time. Drives the "RO 88421 ran until 5:00pm — right?" prompt. */
export function wasAutoStopped(
  slot: TimerSlot,
  now: number,
  capAt: number | null,
): boolean {
  return isAccruing(slot) && capAt !== null && now > capAt;
}
