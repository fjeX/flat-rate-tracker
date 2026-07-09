"use client";

// Persists the browser's timezone to the frt_timezone cookie on first load.
// Server pages derive "today" from that cookie; without it they fall back to
// the container clock (UTC), which disagrees with a Pacific browser between
// 5 PM and midnight — ROs land on "tomorrow" and vanish from the Today card.
// Settings' TimezoneCard remains the manual override.
import { useEffect, useRef } from "react";
import { setTimezoneAction } from "@/app/actions/settings";

export function TimezoneSync({ hasTz }: { hasTz: boolean }) {
  const attempted = useRef(false);

  useEffect(() => {
    if (hasTz || attempted.current) return;
    attempted.current = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    // The action revalidates the root layout, so server-rendered dates
    // recompute with the correct timezone without a manual refresh.
    setTimezoneAction(tz).catch(() => {});
  }, [hasTz]);

  return null;
}
