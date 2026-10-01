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
import { Zone } from "@/components/ui/Zone";
import { Camera } from "lucide-react";

export default async function SnapshotsPage() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const tz = cookieStore.get("frt_timezone")?.value;
  const today = tz ? isoDateInTz(tz) : isoDate();

  const gamification = await db.getGamificationData(supabase, { today });
  const snapshots = gamification?.snapshots ?? [];

  return (
    <main className="snp-page">
      <div className="pagehead">
        <div className="grow">
          <h1>Snapshots</h1>
          <p>
            {gamification ? (
              <>
                Each sheet is a dated record frozen the moment you crossed an RO
                milestone — proof of what you&apos;d documented at that point.
                Next unlock at <span className="num">{gamification.nextSnapshotAt}</span> ROs
                (<span className="num">{gamification.roCount}</span> logged so far).
              </>
            ) : (
              "Each sheet is a dated record frozen the moment you crossed an RO milestone."
            )}
          </p>
        </div>
        <Link href="/dashboard" className="btn btn-quiet">
          Dashboard
        </Link>
      </div>

      <Zone
        name="Work records"
        className={snapshots.length === 0 ? "snp-empty" : undefined}
        aside={
          snapshots.length > 0 ? (
            <><span className="num">{snapshots.length}</span> on record</>
          ) : undefined
        }
      >
        {snapshots.length === 0 ? (
          <EmptyState
            icon={<Camera size={22} />}
            title="No snapshots yet"
            description={
              gamification
                ? `${Math.max(gamification.nextSnapshotAt - gamification.roCount, 0)} more logged ROs freeze your first dated work record.`
                : "Snapshots aren't available yet."
            }
            action={
              <Link href="/log" className="btn btn-go btn-sm">
                Log an RO →
              </Link>
            }
          />
        ) : (
          <ul className="snp-sheets">
            {snapshots.map((s) => (
              <li key={s.id}>
                <SnapshotSheet snapshot={s} timeZone={tz} />
              </li>
            ))}
          </ul>
        )}
      </Zone>
    </main>
  );
}
