import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { capsForSlots } from "@/lib/timer-schedule";
import type { Entry } from "@/lib/types";
import { TimerSlots } from "@/components/timer/TimerSlots";

export default async function TimerPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const timeZone = cookieStore.get("frt_timezone")?.value;

  const [settings, entries, library, slotsOrNull, schedules, shiftOverrides] =
    await Promise.all([
      db.getSettings(supabase),
      db.listEntries(supabase, { limit: 20 }),
      db.listOpCodes(supabase),
      // Null before the active_timers migration lands — the page still renders,
      // just with no timers, rather than 500ing on a half-deployed VM.
      db.listTimerSlotsSafe(supabase),
      db.listWorkSchedulesSafe(supabase),
      db.listShiftOverridesSafe(supabase),
    ]);
  const slots = slotsOrNull ?? [];

  // An RO on a timer can easily be older than the 20 most recent (that's the
  // point of a timer that survives days), so fetch any that the list missed.
  const inList = new Map(entries.map((e) => [e.id, e]));
  const missingIds = slots
    .map((s) => s.entryId)
    .filter((id): id is string => !!id && !inList.has(id));
  const fetched = await Promise.all(
    missingIds.map((id) => db.getEntry(supabase, id)),
  );
  const attachedEntries: Entry[] = [
    ...slots
      .map((s) => (s.entryId ? inList.get(s.entryId) : undefined))
      .filter((e): e is Entry => !!e),
    ...fetched.filter((e): e is Entry => !!e),
  ];

  const caps = capsForSlots(slots, {
    schedules,
    shiftOverrides: shiftOverrides ?? {},
    timeZone,
  });

  return (
    <TimerSlots
      slots={slots}
      attachedEntries={attachedEntries}
      caps={caps}
      recentEntries={entries}
      library={library}
      roTemplates={settings.roTemplates}
    />
  );
}
