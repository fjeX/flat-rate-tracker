"use client";

import { useStored, writeStored } from "./client-storage";

// The dashboard's floating "+" button preference.
//
// The key used to be spelled out in two files — TodayCard (which shows the
// button) and QuickAddCard (which toggles it) — each holding private state over
// the same localStorage entry. Turning it off in Settings therefore left the
// button on the dashboard until a reload. One module, one store: both now read
// the same value and see each other's writes immediately.
const KEY = "frt:quick_add_enabled";

// Opt-out, not opt-in: absent means enabled. "false" is the only value that
// turns it off, which is also what the pre-existing entries in users' browsers
// look like — this must keep reading them.
const parse = (raw: string) => raw !== "false";

export function useQuickAddEnabled(): boolean {
  // The server answers `true` for the same reason the old code seeded useState
  // with `true`: it cannot know. Someone who has turned it off sees it resolve
  // away on hydration, exactly as before.
  return useStored(KEY, parse, true, true);
}

export function setQuickAddEnabled(next: boolean): void {
  writeStored(KEY, String(next));
}
