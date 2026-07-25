import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { Header } from "@/components/layout/Header";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { TimezoneSync } from "@/components/layout/TimezoneSync";
import { TimerPip } from "@/components/timer/TimerPip";
import { anyAccruing } from "@/lib/timer";
import { capsForSlots } from "@/lib/timer-schedule";
import type { Entry } from "@/lib/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Proxy should already redirect unauthenticated users; defense-in-depth.
  if (!user) redirect("/signin");

  const cookieStore = await cookies();
  const hasTz = cookieStore.has("frt_timezone");
  const timeZone = cookieStore.get("frt_timezone")?.value;

  const [isAdmin, slotsOrNull] = await Promise.all([
    db.isCurrentUserAdmin(supabase),
    // Null pre-migration — the nav dot and pip simply don't render.
    db.listTimerSlotsSafe(supabase),
  ]);
  const slots = slotsOrNull ?? [];

  // The dot means "something is banking time right now" — which includes a job
  // sitting on hold, since waiting time is still being recorded.
  const timerRunning = anyAccruing(slots);

  // Only pay for pip data when there's actually a timer to show.
  let pipEntries: Entry[] = [];
  let caps: Record<string, number | null> = {};
  if (slots.length > 0) {
    const [entries, schedules, shiftOverrides] = await Promise.all([
      Promise.all(
        slots
          .map((s) => s.entryId)
          .filter((id): id is string => !!id)
          .map((id) => db.getEntry(supabase, id)),
      ),
      db.listWorkSchedulesSafe(supabase),
      db.listShiftOverridesSafe(supabase),
    ]);
    pipEntries = entries.filter((e): e is Entry => !!e);
    caps = capsForSlots(slots, {
      schedules,
      shiftOverrides: shiftOverrides ?? {},
      timeZone,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TimezoneSync hasTz={hasTz} />
      <Header userEmail={user.email} />
      <Nav timerRunning={timerRunning} />
      <div style={{ flex: 1 }}>{children}</div>
      <Footer isAdmin={isAdmin} />
      <TimerPip slots={slots} entries={pipEntries} caps={caps} />
    </div>
  );
}
