"use client";

// "How long did the X take?" on the dashboard, after a plain Save RO. The page
// resolved and re-checked the line server-side; this only renders and writes.
//
// Two things here exist because of what the App Router does, both seen in a real
// browser and invisible to unit tests:
//
// 1. The candidate is LATCHED. Writing the estimate revalidates /dashboard, the
//    re-rendered page re-runs resolveLightAsk, and the line is now timed, so the
//    page passes `null`. Without the latch that unmounts the "Saved Xh" line the
//    instant it should appear. The page always renders this component, and the
//    first non-null candidate is kept in state for the life of the row.
// 2. The ROUTER owns the URL. A server action's response re-commits the URL the
//    router captured at dispatch (still carrying ?ask=), which undoes a
//    history.replaceState strip. So the param is removed with router.replace,
//    after the write has settled (chip) or immediately (Skip). replace adds no
//    history entry, so Back never re-asks, and the other params survive.
//
// Same swallow-and-close stance as the Log form's version: a failed write just
// closes the row.
import { useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { StatusField } from "@/components/ui/StatusField";
import { LightRetroRow } from "@/components/forms/LightRetroRow";
import { setLineActualHoursAction } from "@/app/actions/entries";
import { LIGHT_ASK_PARAM, type LightRetroCandidate } from "@/lib/retro-capture";

export function DashboardLightAsk({
  candidate,
}: {
  candidate: LightRetroCandidate | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Latch: set once, never cleared by a later null prop.
  const [latched, setLatched] = useState<LightRetroCandidate | null>(candidate);
  if (latched === null && candidate !== null) setLatched(candidate);
  const [status, setStatus] = useState<"ask" | "saving" | "done" | "closed">("ask");
  const [hours, setHours] = useState<number | null>(null);
  const busy = useRef(false);

  function stripAskParam() {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (!params.has(LIGHT_ASK_PARAM)) return;
    params.delete(LIGHT_ASK_PARAM);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  async function answer(h: number) {
    if (!latched || busy.current) return;
    busy.current = true;
    setHours(h);
    setStatus("saving");
    let wrote = true;
    try {
      // onlyIfEmpty: a timer may have added hours since this ask was issued.
      const res = await setLineActualHoursAction(latched.lineId, h, "estimate", {
        onlyIfEmpty: true,
      });
      if (res?.error || res?.skipped) wrote = false;
    } catch {
      wrote = false;
    }
    stripAskParam();
    if (!wrote) {
      setStatus("closed");
      return;
    }
    setStatus("done");
    setTimeout(() => setStatus("closed"), 3500);
  }

  function skip() {
    stripAskParam();
    setStatus("closed");
  }

  if (!latched || status === "closed") return null;
  return (
    <StatusField tag="Note" className="dash-ask">
      <LightRetroRow
        candidate={latched}
        status={status}
        savedHours={hours}
        onAnswer={answer}
        onSkip={skip}
      />
    </StatusField>
  );
}
