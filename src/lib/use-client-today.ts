"use client";

import { useSyncExternalStore } from "react";
import { isoDate } from "./periods";

// "Today" as the BROWSER sees it, or null until the browser has said so.
//
// The guest pages are client components with no timezone cookie, so the only
// clock they have is the one they render with. During SSR that is the VM's
// clock (Pacific); during hydration it is the visitor's. For seven hours a day
// those disagree on the date — every evening after 17:00 Pacific for a UTC
// browser, which is exactly what the deploy gate's smoke browser is — and the
// period label, the week buckets and the day-status text all hydrate as
// different strings. React throws #418 and recovers by re-rendering from the
// root, which is the same recovery the guest layout's force-dynamic comment
// describes wiping the theme class. It rejected a deploy on 2026-09-12 at
// 23:00 Pacific that had passed at 16:19 the same afternoon.
//
// useSyncExternalStore is the sanctioned shape: the server snapshot is null,
// hydration renders with that same null, and React then re-renders with the
// client snapshot without treating it as a mismatch. Callers render nothing
// date-dependent while it is null. The snapshot is a string, so Object.is
// stability holds for free until the date actually rolls over.
const subscribe = () => () => {};
const getSnapshot = () => isoDate();
const getServerSnapshot = () => null;

export function useClientToday(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
