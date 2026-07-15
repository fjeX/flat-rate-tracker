"use client";

import { useEffect, useState } from "react";

// Ticks roughly once per second while `running` is true.
// Browsers throttle interval timers in backgrounded/occluded tabs, which can
// freeze the displayed elapsed time far behind the wall clock even though the
// timestamp math stays correct — so also re-sync the moment the page becomes
// visible, focused, or restored from the back/forward cache.
export function useTickingNow(running: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const sync = () => setNow(Date.now());
    const id = window.setInterval(sync, 1000);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    sync();
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [running]);

  return now;
}
