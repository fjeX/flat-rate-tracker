"use client";

import { useEffect, useReducer } from "react";

/** Fired by any save path that has just called router.refresh(). */
export const FLUSH_EVENT = "frt:flush-refresh";

/**
 * Workaround for bug c655c010 — "the pay period pace doesn't update after the
 * app sits idle".
 *
 * After a save, router.refresh() fetches the new server tree and the payload
 * arrives *correct*: instrumenting the RSC bodies shows the new numbers reach
 * the browser twice, once in the server action's own revalidation payload and
 * once in the refresh. React then commits at ~360ms still rendering the OLD
 * values, and the refreshed tree only gets painted on some later unrelated
 * commit — 15-40s away, or not until the user touches something. Until then the
 * dashboard shows stale numbers with no indication anything is wrong.
 *
 * Any client state update makes React process its pending work and paint the
 * tree it is already holding — in testing, clicking a Week/Period toggle fixed
 * it 100% of the time with zero network. So this listens for FLUSH_EVENT and
 * bumps state a few times across the window the payload realistically lands in.
 * It renders nothing and does no work unless a save just happened.
 *
 * This is a mitigation, not a fix. The defect is in the Next 16 / React 19 App
 * Router reconcile path, not in our code — delete this once that is resolved.
 */
export function RefreshFlusher() {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    function onFlush() {
      timers.forEach(clearTimeout);
      // ~300ms is typical on prod; the later bumps cover a cold container or a
      // slow connection. Cheap — the tree is already rendered, this only makes
      // React commit what it has.
      timers = [250, 600, 1200, 2500].map((ms) => setTimeout(bump, ms));
    }
    window.addEventListener(FLUSH_EVENT, onFlush);
    return () => {
      window.removeEventListener(FLUSH_EVENT, onFlush);
      timers.forEach(clearTimeout);
    };
  }, []);

  return null;
}
