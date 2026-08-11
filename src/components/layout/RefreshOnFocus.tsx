"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { FLUSH_EVENT } from "@/components/layout/RefreshFlusher";
import { markAway, shouldRefetch } from "@/lib/stale-return";

/**
 * Refetches server data when the user comes back to a page they left open.
 *
 * A page renders the data that existed when it loaded, and nothing tells it
 * otherwise. Every save path calls router.refresh() in the tab that performed
 * the save, so that tab is fine — but any *other* view of the same account is
 * stale until something makes it refetch:
 *
 *  - dashboard open in a second tab while an RO is logged in the first
 *    (dashboard-quickadd-cross-tab-stale, 2026-08-10)
 *  - dashboard on the phone, ROs entered on the shop laptop — different
 *    devices, so no same-browser signal can reach it
 *  - a tab backgrounded for hours with no save anywhere: period pace and days
 *    remaining are simply out of date on return
 *
 * A cross-tab broadcast only addresses the first of those. Refetching on return
 * covers all three, and needs no coordination between tabs at all.
 *
 * Deliberately NOT part of RefreshFlusher. That component is a mitigation for
 * bug c655c010 and is meant to be deleted once Next/React fix the reconcile
 * path; this is a permanent behaviour and must not be deleted along with it.
 * The two compose: this refetches, and the FLUSH_EVENT it fires is what gets
 * the arriving tree painted — the same contract every save path already uses.
 *
 * The 30s threshold is what keeps this cheap. Alt-tabbing to read a text costs
 * nothing; only a genuine absence spends a round trip.
 */
export function RefreshOnFocus() {
  const router = useRouter();
  const awayAt = useRef<number | null>(null);

  useEffect(() => {
    // Date.now() is read only inside handlers, never during render — seeding
    // client state from the clock at render time is what caused the hydration
    // mismatches in useTickingNow. Effects run client-only, so this is safe.
    function leave() {
      awayAt.current = markAway(awayAt.current, Date.now());
    }

    function ret() {
      if (document.visibilityState !== "visible") return;
      const since = awayAt.current;
      // Cleared unconditionally: returning ends the absence whether or not it
      // was long enough to act on. Returning fires several of these events, and
      // clearing here is what stops the second one refetching again.
      awayAt.current = null;
      if (!shouldRefetch(since, Date.now())) return;

      router.refresh();
      // The refreshed tree can arrive correct and never get painted (bug
      // c655c010) — nudge React into committing it. See RefreshFlusher.
      window.dispatchEvent(new Event(FLUSH_EVENT));
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") leave();
      else ret();
    }

    document.addEventListener("visibilitychange", onVisibility);
    // Desktop alt-tab away from the browser does not reliably fire
    // visibilitychange while the window stays unoccluded; blur/focus do.
    window.addEventListener("blur", leave);
    window.addEventListener("focus", ret);
    // iOS Safari restores a backgrounded tab from bfcache with pageshow and no
    // visibilitychange — the phone-in-pocket case, so it must be handled.
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", ret);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", ret);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", ret);
    };
  }, [router]);

  return null;
}
