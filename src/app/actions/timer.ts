"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";

// Timer state mutations. State lives on `user_settings`:
//   timer_ro_id        — attached RO (uuid | null)
//   timer_start_time   — epoch ms when the running segment began (null = paused)
//   timer_accumulated  — ms accumulated across prior running segments

function revalidateTimerScreens() {
  // The nav's pulsing green dot is driven by settings loaded in the root
  // app layout, so we revalidate the layout tree too.
  revalidatePath("/timer");
  revalidatePath("/", "layout");
}

export async function startTimerAction(): Promise<void> {
  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  if (settings.timerStartTime !== null) return; // already running
  await db.setTimerState(supabase, {
    roId: settings.timerRoId,
    startTime: Date.now(),
    accumulated: settings.timerAccumulated,
  });
  revalidateTimerScreens();
}

export async function pauseTimerAction(): Promise<void> {
  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  if (settings.timerStartTime === null) return; // already paused
  const elapsed = Date.now() - settings.timerStartTime;
  await db.setTimerState(supabase, {
    roId: settings.timerRoId,
    startTime: null,
    accumulated: settings.timerAccumulated + Math.max(0, elapsed),
  });
  revalidateTimerScreens();
}

export async function resetTimerAction(): Promise<void> {
  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  await db.setTimerState(supabase, {
    roId: settings.timerRoId,
    startTime: null,
    accumulated: 0,
  });
  revalidateTimerScreens();
}

export async function setTimerRoAction(roId: string | null): Promise<void> {
  const supabase = await createClient();
  const settings = await db.getSettings(supabase);
  await db.setTimerState(supabase, {
    roId,
    startTime: settings.timerStartTime,
    accumulated: settings.timerAccumulated,
  });
  revalidateTimerScreens();
}

// Write the timer's elapsed time to a single entry_op_codes line as its
// actualHours, then fully reset the timer (ready state, no RO attached).
export async function saveTimerToLineAction(
  lineId: string,
  hours: number,
): Promise<void> {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("Invalid hours.");
  }
  const supabase = await createClient();
  await db.setLineActualHours(supabase, lineId, hours);
  await db.setTimerState(supabase, {
    roId: null,
    startTime: null,
    accumulated: 0,
  });
  revalidatePath("/timer");
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/pay-period");
  revalidatePath("/", "layout");
}
