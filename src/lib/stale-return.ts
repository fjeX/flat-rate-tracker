/**
 * Absence tracking for RefreshOnFocus.
 *
 * Kept separate from the component because the rules below are where the bugs
 * live, and the component is browser-event wiring the node test environment
 * cannot reach. See RefreshOnFocus.tsx for why refetch-on-return exists.
 */

/** How long the page must have been away before a return is worth a refetch. */
export const STALE_AFTER_MS = 30_000;

/**
 * Stamp the start of an absence.
 *
 * Earliest departure wins. Leaving fires more than one event (a desktop
 * alt-tab is `blur` and often `visibilitychange` too), and overwriting on the
 * second would restart the clock on the way out — so a five-minute absence
 * could measure as a few milliseconds and never trigger a refetch.
 */
export function markAway(awayAt: number | null, now: number): number {
  return awayAt ?? now;
}

/**
 * Whether returning at `now` from an absence that began at `awayAt` should
 * refetch. Null means the page never left, so there is nothing to catch up on.
 */
export function shouldRefetch(
  awayAt: number | null,
  now: number,
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  if (awayAt === null) return false;
  // A clock that moved backwards (NTP correction, DST on a naive clock) yields
  // a negative elapsed, which must not count as stale — treat it as no time
  // passed rather than refetching on every return until the clock catches up.
  return now - awayAt >= staleAfterMs;
}
