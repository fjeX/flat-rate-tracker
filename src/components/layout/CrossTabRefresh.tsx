"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FLUSH_EVENT } from "@/components/layout/RefreshFlusher";

/**
 * Makes a save in one tab show up in the other tabs of the same browser.
 *
 * RefreshOnFocus already covers a tab you LEFT and came back to. It hooks
 * visibilitychange/focus/pageshow, so a tab that is opened and then simply sat
 * in front of — never blurred, never reloaded — has no event to fire and stays
 * stale forever (dashboard-quickadd-cross-tab-stale scenario B, 2026-08-11/12,
 * seen on both dashboard pace and the Pay Period spiffs card).
 *
 * Why a broadcast rather than the interval poll the incident log proposed: the
 * poll's payload would be router.refresh(), which re-runs every dashboard query
 * plus aggregateStats/computeForecast on a schedule, per open tab, forever, and
 * on prod that is now real users. A cheap "did anything change?" probe ahead of
 * it can't be built either — daily_clock_hours and paid_period_hours carry no
 * updated_at, so a version check would miss exactly the clocked-hours and
 * paid-hours edits reconciliation cares about. A broadcast costs nothing, fires
 * only on a real write, and lands immediately instead of up to a minute later.
 *
 * The order matters and is the same contract every save path uses: refetch
 * FIRST, then flush. RefreshFlusher only makes React paint a tree the tab
 * already holds (c655c010) — flushing without refetching would faithfully
 * repaint the same stale numbers, which is why broadcasting FLUSH_EVENT alone
 * was rejected when RefreshOnFocus was built.
 *
 * NOT covered: another DEVICE (phone + shop laptop) sitting on a page that
 * never loses focus. No same-browser channel can reach it, and it still
 * refetches the moment that tab is returned to.
 */

const CHANNEL = "frt:data-changed";

// Identifies this tab so it ignores its own ping. BroadcastChannel delivers to
// every other object on the channel — including a second one in the SAME tab —
// and the saving tab has already called router.refresh() itself.
const TAB_ID = Math.random().toString(36).slice(2);

/**
 * Tell the other tabs that server data just changed. Call it right after the
 * router.refresh() in a save path. Best-effort by design: a tab that misses
 * this still refetches when it is next returned to.
 */
export function notifyDataChanged() {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(TAB_ID);
    ch.close();
  } catch {
    // A failed notify must never break the save that triggered it.
  }
}

export function CrossTabRefresh() {
  const router = useRouter();

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      if (e.data === TAB_ID) return; // our own write; already refreshed
      router.refresh();
      window.dispatchEvent(new Event(FLUSH_EVENT));
    };
    return () => ch.close();
  }, [router]);

  return null;
}
