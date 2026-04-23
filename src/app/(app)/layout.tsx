import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { Header } from "@/components/layout/Header";
import { Nav } from "@/components/layout/Nav";

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

  const settings = await db.getSettings(supabase);
  const timerRunning = settings.timerStartTime !== null;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <Header userEmail={user.email} />
      <Nav timerRunning={timerRunning} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
