// Portfolio snapshots — every dated build sheet the tech has earned
// (docs/gamification.md, design 8B). Snapshots are immutable records;
// this page only renders what generation froze.
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/db";
import { isoDate, isoDateInTz } from "@/lib/periods";
import { SnapshotSheet } from "@/components/snapshots/SnapshotSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { Camera } from "lucide-react";

export default async function SnapshotsPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();

  const gamification = await db.getGamificationData(supabase, { today });

  return (
    <main className="app-main" style={{ paddingBottom: 64 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="section-title">
          Portfolio snapshots
          <Link href="/dashboard" className="link">← Dashboard</Link>
        </div>

        {gamification === null || gamification.snapshots.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Camera size={22} />}
              title="No snapshots yet"
              description={
                gamification
                  ? `${Math.max(gamification.nextSnapshotAt - gamification.roCount, 0)} more logged ROs freeze your first dated work record.`
                  : "Snapshots aren't available yet."
              }
              action={
                <Link href="/log" className="btn btn-primary btn-sm">
                  Log an RO →
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-2)", lineHeight: 1.55 }}>
              Each sheet is a dated record frozen the moment you crossed an RO
              milestone — proof of what you&apos;d documented at that point.
              Next unlock at <b className="tabular" style={{ color: "var(--fg-0)" }}>
                {gamification.nextSnapshotAt} ROs
              </b> ({gamification.roCount} logged so far).
            </p>
            {gamification.snapshots.map((s) => (
              <SnapshotSheet key={s.id} snapshot={s} timeZone={tz} />
            ))}
          </>
        )}
      </div>
    </main>
  );
}
