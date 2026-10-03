"use client";

// The small footnote under the dashboard headline: how old the numbers on screen
// are. Signed-in: "synced 3 min ago". Guest: "on this phone only" — guest data
// never leaves the phone.
//
// The age is measured on the BROWSER's clock only, from the moment this browser
// first received a given fetchedAt. Comparing the server's clock to the phone's
// would print the skew between them as staleness (and in fixture mode, where
// the server clock is pinned, "synced 204 days ago"). fetchedAt is the key, not
// the clock: a remount that reuses a cached payload (same fetchedAt) keeps its
// original first-seen time; router.refresh() brings a new fetchedAt and resets.
//
// Hydration: the first render (server and client) always reads "synced just
// now" because elapsed starts at 0 — no clock is read during render.
import { useEffect, useState } from "react";

/** "synced just now" · "synced 1 min ago" · "synced 12 min ago" · "synced 2 hr ago". */
export function syncedLabel(fetchedAtMs: number, nowMs: number): string {
  const mins = Math.max(0, Math.floor((nowMs - fetchedAtMs) / 60_000));
  if (mins < 1) return "synced just now";
  if (mins < 60) return `synced ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `synced ${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `synced ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** fetchedAt → when this browser first saw it (browser clock). */
const firstSeen = new Map<string, number>();

export function SyncedNote({ fetchedAt }: { fetchedAt: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let seen = firstSeen.get(fetchedAt);
    if (seen === undefined) {
      seen = Date.now();
      firstSeen.set(fetchedAt, seen);
    }
    const base = seen;
    const tick = () => setElapsed(Date.now() - base);
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  if (!fetchedAt) return null;
  return <p className="dash-synced">{syncedLabel(0, elapsed)}</p>;
}

/** Guest dashboards keep everything in the browser; say so in the same spot. */
export function GuestSyncedNote() {
  return <p className="dash-synced">on this phone only</p>;
}
