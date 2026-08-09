"use client";

import { useEffect, useState } from "react";

// Ticks roughly once per second while `running` is true.
//
// Browsers throttle interval timers in backgrounded/occluded tabs, which can
// freeze the displayed elapsed time far behind the wall clock even though the
// timestamp math stays correct. Two layers of defense:
//  - the tick runs in a dedicated Web Worker — worker timers are exempt from
//    page-visibility throttling, so the display keeps tracking wall clock
//    even when the tab is hidden or the window is occluded (the main-thread
//    setInterval + visibilitychange approach still lagged there; see the
//    timer-display-lag incident, 2026-07-15)
//  - visibility/focus/pageshow listeners re-sync immediately on return, so a
//    restored tab never shows even one stale second
// Falls back to a plain setInterval when Workers are unavailable.
//
// Returns null until the component has mounted on the client, which is the
// honest answer: there is no single wall clock the server and the browser can
// agree on. Seeding with Date.now() during render stamped one second into the
// SSR HTML and hydrated with another, so any elapsed time rendered as text
// mismatched and React threw #418 — on the pip (fixed 2026-08-02) and then
// again on /timer's own cards (timer-page-hydration-418). Fixing it per-caller
// meant every future consumer had to remember; fixing it here means they
// can't forget. Callers treat null as "exclude the in-flight segment" — see
// elapsedFor.
export function useTickingNow(running: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);

  // Adopt the real clock once mounted, even when nothing is accruing — the
  // ticking effect below returns early in that case and would leave `now` null
  // indefinitely.
  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!running) return;
    const sync = () => setNow(Date.now());

    let worker: Worker | null = null;
    let intervalId: number | null = null;
    try {
      const src = URL.createObjectURL(
        new Blob(["setInterval(() => postMessage(0), 1000);"], {
          type: "text/javascript",
        }),
      );
      worker = new Worker(src);
      URL.revokeObjectURL(src);
      worker.onmessage = sync;
    } catch {
      intervalId = window.setInterval(sync, 1000);
    }

    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    sync();
    return () => {
      worker?.terminate();
      if (intervalId !== null) window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [running]);

  return now;
}
