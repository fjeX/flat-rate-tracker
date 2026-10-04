import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { Header } from "@/components/layout/Header";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { TimezoneSync } from "@/components/layout/TimezoneSync";
import { RefreshFlusher } from "@/components/layout/RefreshFlusher";
import { RefreshOnFocus } from "@/components/layout/RefreshOnFocus";
import { CrossTabRefresh } from "@/components/layout/CrossTabRefresh";
import { TimerPip } from "@/components/timer/TimerPip";
import { ReplyNoticeModal } from "@/components/layout/ReplyNoticeModal";
import { AppearanceSync } from "@/components/layout/AppearanceSync";
import { backfillLaborTimeObservations } from "@/lib/true-time-sync";
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

  const [isAdmin, slotsOrNull, settings, replyNotices] = await Promise.all([
    db.isCurrentUserAdmin(supabase),
    // Null pre-migration — the nav dot and pip simply don't render.
    db.listTimerSlotsSafe(supabase),
    // Only for AppearanceSync: the account's look, copied into this browser on
    // its first signed-in visit (the head script only ever reads localStorage).
    db.getSettings(supabase),
    // Admin replies to this user's bug reports / feature requests. Never throws.
    db.listUnseenRepliesSafe(supabase),
  ]);
  const slots = slotsOrNull ?? [];

  // True Time: an account that opted in before the backfill existed has timed
  // lines that never reached the pool. `settings` is already loaded above, so
  // the steady state (stamp set, or sharing off) costs no extra query. after()
  // runs once the response has streamed, so rendering never waits on it; the
  // function claims the stamp atomically, so concurrent tabs do not double-run.
  if (settings.shareLaborTimes && settings.trueTimeBackfilledAt === null) {
    after(() => backfillLaborTimeObservations(supabase));
  }

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
    <div className="shell-frame">
      <TimezoneSync hasTz={hasTz} />
      <RefreshFlusher />
      <RefreshOnFocus />
      {/* RefreshOnFocus covers a tab you left and came back to; this covers a
          tab that never lost focus at all. */}
      <CrossTabRefresh />
      <AppearanceSync userId={user.id} theme={settings.theme} accent={settings.accent} />
      <Header userEmail={user.email} timerRunning={timerRunning} />
      <Nav timerRunning={timerRunning} />
      <div style={{ flex: 1 }}>{children}</div>
      <Footer isAdmin={isAdmin} />
      <TimerPip slots={slots} entries={pipEntries} caps={caps} />
      <ReplyNoticeModal notices={replyNotices} />
    </div>
  );
}
