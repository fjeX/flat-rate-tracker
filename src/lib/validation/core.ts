import { z } from "zod";

/**
 * The parse boundary for server actions.
 *
 * WHY THIS EXISTS. Every exported function in a `"use server"` module is a live
 * POST endpoint. The browser bundle calls them with well-formed arguments, but
 * nothing about the transport requires that: the action id and the argument
 * array are both visible in the network tab, and a hand-rolled request can send
 * any JSON it likes. TypeScript's parameter types are erased at build time, so
 * `hours: number` is a promise the runtime never checks.
 *
 * RLS is what keeps a caller inside their own rows, and it was verified airtight
 * on prod (2026-08-14). This layer answers a different question — not "whose row
 * is it" but "is this even the shape of a row" — and it answers it in one place
 * so every action rejects garbage the same way.
 *
 * TWO RULES THIS FILE FOLLOWS, BOTH LEARNED THE HARD WAY:
 *
 * 1. **Never validate tighter than the database already does.** Every bound here
 *    is either a rule the action already enforced by hand, or the ceiling of the
 *    column the value lands in. A value that would fail here would have failed at
 *    Postgres anyway — so validation can only improve the error message, never
 *    reject a save that works today. Inventing a stricter rule is how a
 *    validation pass breaks a real user's Friday afternoon.
 *
 * 2. **Use the parsed output, never the raw input.** `z.object()` strips keys it
 *    doesn't declare, so the value that comes back out of `validate()` is a
 *    whitelist by construction. Passing the original object on instead of the
 *    parsed one throws that away.
 *
 * Schemas live here and in `./actions.ts` rather than beside the actions because
 * a `"use server"` module may only export async functions — exporting a schema
 * from one ships a dangling runtime binding that no compiler catches. See the
 * note above `importDataAction`.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * The first issue's message, which is what the user sees.
 *
 * Zod reports every failure; a form field can only show one sentence. First
 * issue wins because schemas are declared in the order the user filled the form
 * in, so it is also the earliest thing they got wrong.
 */
function firstMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "That request wasn't valid.";
  return issue.message;
}

/**
 * Validate and return the parsed value, or throw with a user-readable message.
 *
 * Throwing is right for the majority of actions: they are called from a client
 * component inside a try/catch that surfaces `err.message`, so an invalid
 * argument reads as a sentence rather than a stack trace.
 */
export function validate<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(firstMessage(result.error));
  return result.data;
}

/**
 * Non-throwing variant for the actions that answer with `{ error }` instead of
 * throwing — the auth and account forms, which render the message inline and
 * must not blow up a server render to do it.
 */
export function check<S extends z.ZodType>(
  schema: S,
  value: unknown,
):
  | { ok: true; data: z.output<S> }
  | { ok: false; error: string } {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: firstMessage(result.error) };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Deliberately looser than `z.uuid()`, which enforces RFC 9562 version and
 * variant bits. Every id in this app comes from `gen_random_uuid()` or
 * `crypto.randomUUID()` and would pass either way — but rows predate rules, and
 * the job here is to reject "'; drop table" and `{}`, not to audit which UUID
 * version a row was born under. Postgres is the one that owns that opinion.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An id headed for a `uuid` column.
 *
 * `missingMessage` overrides the "required" sentence for the actions that
 * already had better copy for it ("Pick an RO first."). The invalid-shape
 * message is always derived from the label, because a user can't type an id —
 * only a caller off the happy path can reach it.
 */
export function uuidField(label: string, missingMessage?: string) {
  const missing = missingMessage ?? `${label} is required.`;
  return z
    .string({ error: missing })
    .min(1, { error: missing })
    .refine((v) => UUID_RE.test(v), { error: `${label} is not a valid ID.` });
}

/** Same, but `null` is a real answer (clearing a link, an unassigned line). */
export function nullableUuid(label: string) {
  return uuidField(label).nullable();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" AND a day that exists. Exported so schemas can reuse the test
 *  while supplying their own copy for the missing-vs-malformed cases. */
export function isCalendarDate(v: unknown): boolean {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * A calendar date headed for a `date` column.
 *
 * Checks the calendar as well as the shape: `2026-02-31` matches the regex the
 * actions used to test and is not a day, so it reached Postgres as a cast error
 * with no useful message. Nothing that works today fails here — a date column
 * refuses a non-date either way.
 */
export function isoDate(message: string) {
  return z.string({ error: message }).refine(isCalendarDate, { error: message });
}

/** "2026-04-P1" — the shape `getRangeForPeriodKey` can actually resolve. */
export function periodKey(message = "Period key is required.") {
  return z
    .string({ error: message })
    .refine((v) => /^\d{4}-(0[1-9]|1[0-2])-P[12]$/.test(v), { error: message });
}

/**
 * A non-negative hours figure.
 *
 * `max` is the ceiling of the numeric column it lands in — numeric(5,2) tops out
 * at 999.99, so 1000 was already a Postgres overflow error before this existed.
 * NaN and Infinity fail the type check first: `z.number()` rejects both, which
 * is the same answer `Number.isFinite` gave.
 */
export function hours(label: string, max: number) {
  const message = `${label} must be a non-negative number.`;
  return z
    .number({ error: message })
    .refine(Number.isFinite, { error: message })
    .min(0, { error: message })
    .max(max, { error: `${label} can't be more than ${max}.` });
}

/** A non-negative dollar figure. Same reasoning as `hours`. */
export function dollars(label: string, max: number) {
  const message = `${label} must be a dollar figure of $0 or more.`;
  return z
    .number({ error: message })
    .refine(Number.isFinite, { error: message })
    .min(0, { error: message })
    .max(max, { error: `${label} can't be more than ${max}.` });
}

/**
 * Free text with a generous ceiling.
 *
 * These columns are `text` and have no length limit, so no cap here is enforcing
 * a product rule — the caps exist so a scripted caller can't park a megabyte of
 * notes in a row that renders on the dashboard. Every limit is far past anything
 * a person types.
 */
export function freeText(max: number) {
  return z.string({ error: "That value must be text." }).max(max, {
    error: `That's too long — keep it under ${max} characters.`,
  });
}

/** Free text that must actually say something. */
export function requiredText(message: string, max: number) {
  return z
    .string({ error: message })
    .trim()
    .min(1, { error: message })
    .max(max, { error: `That's too long — keep it under ${max} characters.` });
}

/**
 * A storage object path.
 *
 * Ownership is checked separately by the actions that sign or overwrite one
 * (the path's first segment must be the caller's user id) — that check is the
 * real guard and this does not replace it. What this adds is the shape: no
 * traversal segments, no NUL, no newline, so a path can't be smuggled sideways
 * past a `startsWith` test.
 */
export function storagePath(message: string) {
  return z
    .string({ error: message })
    .min(1, { error: message })
    .max(1024, { error: message })
    .refine(
      (v) => !v.includes("..") && !/[\u0000-\u001f]/.test(v),
      { error: message },
    );
}

// ---------------------------------------------------------------------------
// Column ceilings
// ---------------------------------------------------------------------------
// Named after the column they come from so the next person can check them
// against a migration instead of guessing what the number meant.

/** numeric(5,2) — entry_op_codes.flag_hours / .actual_hours / .paid_hours */
export const MAX_NUMERIC_5_2 = 999.99;
/** numeric(4,2) — daily_clock_hours.hours */
export const MAX_NUMERIC_4_2 = 99.99;
/** numeric(6,2) — paid_period_hours.paid_flag_hours, labor_rates.hourly_rate */
export const MAX_NUMERIC_6_2 = 9999.99;
/** numeric(8,2) — bonuses.amount */
export const MAX_NUMERIC_8_2 = 999999.99;

/** Free-text ceilings. Generous on purpose — see `freeText`. */
export const TEXT_LIMITS = {
  roNumber: 64,
  vehicleField: 128,
  notes: 10_000,
  opCode: 64,
  description: 512,
  tag: 64,
  name: 200,
  email: 320, // the RFC 5321 maximum
  url: 2048,
} as const;

// ---------------------------------------------------------------------------
// FormData
// ---------------------------------------------------------------------------

/**
 * Pull a text field out of FormData as a string.
 *
 * `formData.get()` returns `File | string | null`, and every action here casts
 * it to `string | null` — which is a lie when the field arrived as a file, and a
 * `File` then flows on as if it were text. Returning null for a non-string makes
 * that case a missing field instead, which every schema already handles.
 */
export function formText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}
