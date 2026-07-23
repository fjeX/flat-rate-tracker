import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { Header } from "@/components/layout/Header";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { TimezoneSync } from "@/components/layout/TimezoneSync";
import { TimerPip } from "@/components/timer/TimerPip";
import type { Entry, OpCode } from "@/lib/types";

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

  const settings = await db.getSettings(supabase);
  const isAdmin = await db.isCurrentUserAdmin(supabase);
  const timerRunning = settings.timerStartTime !== null;
  const timerActive = timerRunning || settings.timerAccumulated > 0;

  // Only fetch pip data when the timer has something to show
  let pipEntry: Entry | null = null;
  let pipLibrary: OpCode[] = [];
  if (timerActive) {
    const [entry, library] = await Promise.all([
      settings.timerRoId
        ? db.getEntry(supabase, settings.timerRoId)
        : Promise.resolve(null),
      db.listOpCodes(supabase),
    ]);
    pipEntry = entry;
    pipLibrary = library;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TimezoneSync hasTz={hasTz} />
      <Header userEmail={user.email} />
      <Nav timerRunning={timerRunning} />
      <div style={{ flex: 1 }}>{children}</div>
      <Footer isAdmin={isAdmin} />
      <TimerPip
        initialTimer={{
          roId: settings.timerRoId,
          startTime: settings.timerStartTime,
          accumulated: settings.timerAccumulated,
        }}
        attachedEntry={pipEntry}
        library={pipLibrary}
      />
    </div>
  );
}
