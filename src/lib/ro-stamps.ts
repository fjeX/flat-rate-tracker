// "Logged Oct 2, 9:14 PM · Last edited 9:40 PM" — the quiet provenance line on
// an RO detail. Pure, so the modal and the guest modal share one reading.

/** A saved-then-touched-up-a-second-later row is not "edited". */
const EDIT_GRACE_MS = 60_000;

function dateText(d: Date, tz?: string, withYear = false): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: tz,
  });
}
function yearOf(d: Date, tz?: string): string {
  return d.toLocaleDateString("en-US", { year: "numeric", timeZone: tz });
}
function timeText(d: Date, tz?: string): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
}

/**
 * `tz` is an IANA zone; leave it undefined to use the browser's own zone (the
 * modals only render after a tap, in the browser, so that is the tech's zone).
 * The year is shown only when a date is not in the current year (`now`).
 * Returns "" when createdAt is unparseable.
 */
export function formatLoggedStamp(
  createdAt: string,
  updatedAt?: string | null,
  tz?: string,
  now: Date = new Date(),
): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  const thisYear = yearOf(now, tz);
  const label = (d: Date) => dateText(d, tz, yearOf(d, tz) !== thisYear);
  let out = `Logged ${label(created)}, ${timeText(created, tz)}`;
  if (!updatedAt) return out;
  const updated = new Date(updatedAt);
  if (Number.isNaN(updated.getTime())) return out;
  if (updated.getTime() - created.getTime() <= EDIT_GRACE_MS) return out;
  const sameDay = dateText(created, tz, true) === dateText(updated, tz, true);
  out += ` · Last edited ${sameDay ? "" : `${label(updated)}, `}${timeText(updated, tz)}`;
  return out;
}
