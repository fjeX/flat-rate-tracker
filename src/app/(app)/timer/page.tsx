import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { TimerView } from "@/components/timer/TimerView";

export default async function TimerPage() {
  const supabase = await createClient();

  const [settings, entries, library] = await Promise.all([
    db.getSettings(supabase),
    db.listEntries(supabase, { limit: 20 }),
    db.listOpCodes(supabase),
  ]);

  // The attached RO may be outside the 20 most-recent window, so fetch by id
  // if we have one that isn't already in the list.
  const inList = settings.timerRoId
    ? entries.find((e) => e.id === settings.timerRoId) ?? null
    : null;
  const attachedEntry =
    settings.timerRoId && !inList
      ? await db.getEntry(supabase, settings.timerRoId)
      : inList;

  return (
    <TimerView
      initialTimer={{
        roId: settings.timerRoId,
        startTime: settings.timerStartTime,
        accumulated: settings.timerAccumulated,
      }}
      attachedEntry={attachedEntry}
      recentEntries={entries}
      library={library}
    />
  );
}
