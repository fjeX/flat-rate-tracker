import { z } from "zod";
import {
  freeText,
  hours,
  dollars,
  isCalendarDate,
  isoDate,
  nullableUuid,
  periodKey,
  requiredText,
  storagePath,
  uuidField,
  MAX_NUMERIC_4_2,
  MAX_NUMERIC_5_2,
  MAX_NUMERIC_6_2,
  TEXT_LIMITS,
} from "./core";
import { LABOR_TYPES } from "@/lib/earnings";
import { BONUS_CATEGORIES } from "@/lib/bonuses";
import { TIMER_STATUSES } from "@/lib/timer";
import {
  BUG_CATEGORIES,
  BUG_SEVERITIES,
  BUG_STATUSES,
  MAX_BUG_DESCRIPTION_CHARS,
} from "@/lib/bug-reports";
import {
  COMEBACK_KINDS,
  DISPUTE_STATUSES,
  UNPAID_TIME_KINDS,
  type ComebackKind,
  type DisputeStatus,
  type LaborType,
  type UnpaidTimeKind,
} from "@/lib/types";

/**
 * One schema per server action argument list.
 *
 * Read the header of ./core.ts first — it explains why this lives outside the
 * `"use server"` modules and the two rules every schema here follows.
 *
 * WHERE THIS IS DELIBERATELY LOOSER THAN THE TYPES: any field the database
 * already defaults is `.optional()` with that same default, not required. The
 * TypeScript type demands it, but TypeScript is not what's on the other end of
 * the wire — the guest-mode sync replays entries out of a browser's
 * localStorage that an older build wrote, and a field that arrived undefined
 * then reached a column default rather than an error. Requiring it here would
 * turn "your offline ROs synced" into "your offline ROs are stuck".
 *
 * THE ONE PLACE IT IS STRICTER: `flagHours` on an RO line is required. It has a
 * column default of 0, so an omitted one currently saves silently as zero — and
 * zero flag hours is a tech working for free. Every caller in the app sends it;
 * a caller that doesn't should hear about it.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/**
 * Membership in a list the app already owns.
 *
 * Built on `z.custom` rather than `z.enum` so the single source of truth stays
 * the exported `readonly T[]` next to the type it describes — an enum built
 * from a copy of that list is a second list, and second lists drift.
 */
function oneOf<T extends string>(
  values: readonly T[],
  message: string | ((input: unknown) => string),
) {
  return z.custom<T>(
    (v) => typeof v === "string" && (values as readonly string[]).includes(v),
    {
      error:
        typeof message === "string" ? message : (issue) => message(issue.input),
    },
  );
}

const laborType = oneOf<LaborType>(
  LABOR_TYPES,
  (v) => `Unknown labor type: ${String(v)}`,
);

/** A line's type, where "untyped" is the user explicitly declining to price it. */
const lineLaborType = oneOf<LaborType | "untyped">(
  [...LABOR_TYPES, "untyped"],
  (v) => `Unknown labor type: ${String(v)}`,
);

const actualSource = oneOf<"timer" | "estimate">(
  ["timer", "estimate"],
  "Unrecognized source for actual hours.",
);

const comebackKind = oneOf<ComebackKind>(
  COMEBACK_KINDS,
  "Unrecognized comeback kind.",
);

const unpaidTimeKind = oneOf<UnpaidTimeKind>(
  UNPAID_TIME_KINDS,
  "Unrecognized unpaid-time reason.",
);

const disputeStatus = oneOf<DisputeStatus>(
  DISPUTE_STATUSES,
  (v) => `Unknown status: ${String(v)}`,
);

const timerStatus = oneOf(TIMER_STATUSES, "Unknown timer status.");

const bonusCategory = oneOf(
  BONUS_CATEGORIES,
  (v) => `Unknown category: ${String(v)}`,
);

// ---------------------------------------------------------------------------
// Shared ids
// ---------------------------------------------------------------------------

export const entryIdSchema = uuidField("Entry ID");
export const lineIdSchema = uuidField("Line ID");
export const opCodeIdSchema = uuidField("Op code id");
export const bonusIdSchema = uuidField("Bonus ID");
export const disputeIdSchema = uuidField("Dispute ID");
export const photoIdSchema = uuidField("Photo ID");
export const dayOffIdSchema = uuidField("Day-off id");
export const scheduleIdSchema = uuidField("Schedule id");
export const reportIdSchema = uuidField("Report id");
export const timerIdSchema = uuidField("Timer ID");

// ---------------------------------------------------------------------------
// entries.ts
// ---------------------------------------------------------------------------

/** Paging offset for the history list. */
export const offsetSchema = z
  .number({ error: "Offset must be a number." })
  .int({ error: "Offset must be a whole number." })
  .min(0, { error: "Offset can't be negative." })
  .max(1_000_000, { error: "Offset is out of range." });

/** The duplicate-RO lookup. Empty is a real answer — the action returns []. */
export const roNumberQuerySchema = z
  .string({ error: "RO number must be text." })
  .max(TEXT_LIMITS.roNumber, { error: "That RO number is too long." });

const vehicleSchema = z
  .object({
    year: freeText(TEXT_LIMITS.vehicleField).optional().default(""),
    make: freeText(TEXT_LIMITS.vehicleField).optional().default(""),
    model: freeText(TEXT_LIMITS.vehicleField).optional().default(""),
    vin: freeText(TEXT_LIMITS.vehicleField).optional().default(""),
    mileage: freeText(TEXT_LIMITS.vehicleField).optional().default(""),
  })
  .optional()
  .default({ year: "", make: "", model: "", vin: "", mileage: "" });

/** One op-code line on an RO. */
export const entryLineSchema = z.object({
  id: uuidField("Line ID").optional(),
  opCodeId: nullableUuid("Op code id").optional().default(null),
  custom: z.boolean({ error: "Custom must be true or false." }).optional().default(false),
  customCode: freeText(TEXT_LIMITS.opCode).nullable().optional().default(null),
  customDescription: freeText(TEXT_LIMITS.description)
    .nullable()
    .optional()
    .default(null),
  // Required — see the header. Everything else on this line has a column
  // default; this one has a column default that lies about what happened.
  flagHours: hours("Flag hours", MAX_NUMERIC_5_2),
  actualHours: hours("Actual hours", MAX_NUMERIC_5_2)
    .nullable()
    .optional()
    .default(null),
  notes: freeText(TEXT_LIMITS.notes).optional().default(""),
  // The DB layer renumbers every line by array index on write, so this is
  // decorative by the time it lands. Validated anyway: it is still a number
  // that gets read on the way through.
  position: z
    .number({ error: "Line position must be a number." })
    .int({ error: "Line position must be a whole number." })
    .min(0, { error: "Line position can't be negative." })
    .max(9999, { error: "Too many lines on one RO." })
    .optional()
    .default(0),
  subOpCodeId: nullableUuid("Sub op code id").optional().default(null),
  laborType: lineLaborType.nullable().optional().default(null),
  paidHours: hours("Paid hours", MAX_NUMERIC_5_2).nullable().optional(),
  isComeback: z
    .boolean({ error: "Comeback must be true or false." })
    .optional(),
  actualSource: actualSource.nullable().optional(),
});

export const newEntrySchema = z.object({
  date: z
    .string({ error: "Date is required." })
    .min(1, { error: "Date is required." })
    .refine(isCalendarDate, { error: "Date must be in YYYY-MM-DD format." }),
  roNumber: requiredText("RO number is required.", TEXT_LIMITS.roNumber),
  vehicle: vehicleSchema,
  notes: freeText(TEXT_LIMITS.notes).optional().default(""),
  opCodes: z
    .array(entryLineSchema, { error: "Add at least one op code." })
    .min(1, { error: "Add at least one op code." }),
  comebackOfEntryId: nullableUuid("Original RO ID").optional().default(null),
  comebackKind: comebackKind.nullable().optional().default(null),
});

/** addOpCodeLineToEntryAction — the line arrives without a position. */
export const addLineSchema = z.object({
  entryId: entryIdSchema,
  line: entryLineSchema.omit({ position: true }),
});

export const setLineActualHoursSchema = z.object({
  lineId: lineIdSchema,
  actualHours: hours("Actual hours", MAX_NUMERIC_5_2).nullable(),
  actualSource: actualSource.nullable().optional().default("timer"),
});

export const setLinePaidHoursSchema = z.object({
  lineId: lineIdSchema,
  paidHours: hours("Paid hours", MAX_NUMERIC_5_2).nullable(),
});

// ---------------------------------------------------------------------------
// account.ts + auth.ts
// ---------------------------------------------------------------------------

/**
 * NO EMAIL-FORMAT CHECK ANYWHERE IN AUTH, ON PURPOSE.
 *
 * GoTrue owns what an address is, and it is the thing that will reject one.
 * A second opinion here can only disagree — and the way it disagrees is by
 * refusing an address the identity provider would have accepted, which locks
 * someone out of their own account to enforce a rule the app doesn't own.
 * Presence and a length ceiling are the parts that are ours.
 *
 * The cap is the RFC 5321 maximum, well past any real address.
 */
const emailField = (message: string) =>
  z
    .string({ error: message })
    .trim()
    .min(1, { error: message })
    .max(TEXT_LIMITS.email, { error: "That email address is too long." });

export const profileFormSchema = z.object({
  firstName: freeText(TEXT_LIMITS.name).optional().default(""),
  lastName: freeText(TEXT_LIMITS.name).optional().default(""),
});

export const updateEmailSchema = z.object({
  email: emailField("Email is required."),
});

/**
 * Password fields are capped but never floored beyond the existing 8-character
 * rule. The cap is a request-size guard, not a policy: it sits far above
 * GoTrue's own limit, so it can't be what refuses an existing password during
 * the current-password check.
 */
const passwordField = (message: string) =>
  z.string({ error: message }).max(512, { error: "That password is too long." });

export const updatePasswordSchema = z
  .object({
    currentPassword: passwordField("Enter your current password.").optional().default(""),
    newPassword: passwordField("Password must be at least 8 characters.")
      .min(8, { error: "Password must be at least 8 characters." }),
    confirmPassword: passwordField("Passwords do not match.").optional().default(""),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    error: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const signUpSchema = z.object({
  email: emailField("Email and password are required."),
  password: passwordField("Email and password are required.")
    .min(1, { error: "Email and password are required." })
    .min(8, { error: "Password must be at least 8 characters." }),
});

export const signInSchema = z.object({
  email: emailField("Email and password are required."),
  password: passwordField("Email and password are required.").min(1, {
    error: "Email and password are required.",
  }),
});

export const passwordResetRequestSchema = z.object({
  email: emailField("Enter the email address on your account."),
});

// ---------------------------------------------------------------------------
// auth/callback route
// ---------------------------------------------------------------------------

/** The one-time OAuth/PKCE code GoTrue puts in the query string. */
export const oauthCodeSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((v) => /^[A-Za-z0-9._~+/=-]+$/.test(v));

/**
 * A `x-forwarded-host` value we're willing to build a redirect out of.
 *
 * The header decides where the browser lands after the code exchange, and
 * anything upstream of Traefik can set it. This does not make the header
 * trustworthy — it makes it *inert*: a hostname (optionally with a port) and
 * nothing else, so it can't carry a path, a second scheme, an `@` that reparents
 * the authority, or a CRLF. A wrong-but-well-formed host still redirects to the
 * wrong place; pinning that would need the site's own hostname in the
 * environment, which this deployment doesn't set.
 */
export const forwardedHostSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((v) => /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(v));

// ---------------------------------------------------------------------------
// bonuses.ts
// ---------------------------------------------------------------------------

export const newBonusSchema = z.object({
  date: isoDate("Date must be in YYYY-MM-DD format."),
  // 999999 rather than the column's 999999.99: the existing rule, kept.
  amount: dollars("Amount", 999_999),
  category: bonusCategory,
  source: freeText(TEXT_LIMITS.name).nullable().optional(),
  note: freeText(TEXT_LIMITS.notes).nullable().optional(),
  entryId: nullableUuid("RO ID").optional(),
});

export const recentRosLimitSchema = z
  .number({ error: "Limit must be a number." })
  .int({ error: "Limit must be a whole number." })
  .min(1, { error: "Limit must be at least 1." })
  .max(200, { error: "Limit can't be more than 200." })
  .optional()
  .default(20);

// ---------------------------------------------------------------------------
// bug-reports.ts
// ---------------------------------------------------------------------------

/**
 * Auto-captured context is TRUNCATED, not rejected.
 *
 * The description is the report; the URL, user agent and viewport are telemetry
 * the client attaches without the reporter knowing. Throwing away a bug report
 * because a browser sent a long user-agent string would lose the only thing of
 * value to protect a `text` column that has no limit anyway.
 */
const truncated = (max: number) =>
  z
    .string()
    .transform((v) => v.slice(0, max))
    .nullable()
    .optional()
    .default(null);

export const submitBugSchema = z.object({
  description: z
    .string({ error: "Please describe the bug before sending." })
    .trim()
    .min(1, { error: "Please describe the bug before sending." })
    .max(MAX_BUG_DESCRIPTION_CHARS, {
      error: `Description is too long — keep it under ${MAX_BUG_DESCRIPTION_CHARS} characters.`,
    }),
  pageUrl: truncated(TEXT_LIMITS.url),
  userAgent: truncated(1024),
  viewport: truncated(64),
});

/**
 * "" clears a field back to untriaged; anything else must be in the vocabulary.
 *
 * Written as one predicate rather than `z.union([z.literal(""), oneOf(...)])`:
 * when every branch of a union fails, the reported issue is the union's, so a
 * bad severity came back as the bare "Invalid input".
 */
const triageField = <T extends string>(values: readonly T[], message: string) =>
  z
    .custom<T | "">(
      (v) =>
        typeof v === "string" &&
        (v === "" || (values as readonly string[]).includes(v)),
      { error: message },
    )
    .optional();

export const bugTriageSchema = z.object({
  reportId: reportIdSchema,
  patch: z.object({
    severity: triageField(BUG_SEVERITIES, "Invalid severity."),
    category: triageField(BUG_CATEGORIES, "Invalid category."),
    status: oneOf(BUG_STATUSES, "Invalid status.").optional(),
    triageNotes: freeText(TEXT_LIMITS.notes).optional(),
  }),
});

// ---------------------------------------------------------------------------
// daily-clock.ts
// ---------------------------------------------------------------------------

export const dailyClockSchema = z.object({
  date: isoDate("Invalid date format."),
  // numeric(4,2) — there are only 24 hours in a day, but the column is what
  // decides, and the column says 99.99.
  hours: hours("Hours", MAX_NUMERIC_4_2),
});

// ---------------------------------------------------------------------------
// disputes.ts
// ---------------------------------------------------------------------------

const MAX_DISPUTE_HOURS = 99_999; // the action's existing numeric(7,2) ceiling
const MAX_DISPUTE_DOLLARS = 99_999_999; // numeric(10,2)

/** Keeps the ledger's own phrasing rather than the generic hours message. */
const disputeHours = (label: string) => {
  const message = `${label} must be an hours figure of 0 or more.`;
  return z
    .number({ error: message })
    .refine(Number.isFinite, { error: message })
    .min(0, { error: message })
    .max(MAX_DISPUTE_HOURS, { error: message });
};

const disputeDollars = (label: string) => {
  const message = `${label} must be a dollar figure of $0 or more.`;
  return z
    .number({ error: message })
    .refine(Number.isFinite, { error: message })
    .min(0, { error: message })
    .max(MAX_DISPUTE_DOLLARS, { error: message });
};

export const openDisputeSchema = z.object({
  periodKey: periodKey("Period is required."),
  options: z
    .object({
      includePending: z
        .boolean({ error: "Include-pending must be true or false." })
        .optional(),
    })
    .optional()
    .default({}),
});

export const setDisputeStatusSchema = z.object({
  id: disputeIdSchema,
  status: disputeStatus,
});

export const disputeOutcomeSchema = z.object({
  id: disputeIdSchema,
  input: z.object({
    recoveredHours: disputeHours("Recovered hours"),
    recoveredDollars: disputeDollars("Recovered dollars").nullable().optional(),
    note: freeText(TEXT_LIMITS.notes).optional(),
    status: disputeStatus.optional(),
  }),
});

export const disputeLineRecoverySchema = z.object({
  lineId: uuidField("Line ID"),
  recoveredHours: disputeHours("Recovered hours"),
  recoveredDollars: disputeDollars("Recovered dollars").nullable().optional(),
});

// ---------------------------------------------------------------------------
// entry-photos.ts
// ---------------------------------------------------------------------------

export const photoStoragePathSchema = storagePath("Storage path is required.");

// ---------------------------------------------------------------------------
// gamification.ts
// ---------------------------------------------------------------------------

export const dayOffSchema = z
  .object({
    startDate: isoDate("Dates must be in YYYY-MM-DD format."),
    endDate: isoDate("Dates must be in YYYY-MM-DD format."),
  })
  .refine((v) => v.startDate <= v.endDate, {
    error: "Start date must be on or before end date.",
    path: ["endDate"],
  });

// ---------------------------------------------------------------------------
// labor-rates.ts
// ---------------------------------------------------------------------------

const RATE_MESSAGE = "Rate must be a number between 0 and 9999.";

export const laborRatesSchema = z.array(
  z.object({
    laborType,
    hourlyRate: z
      .number({ error: RATE_MESSAGE })
      .refine(Number.isFinite, { error: RATE_MESSAGE })
      .min(0, { error: RATE_MESSAGE })
      .max(9999, { error: RATE_MESSAGE })
      .nullable(),
  }),
  { error: "Expected a list of labor rates." },
);

export const defaultLaborTypeSchema = laborType.nullable();

// ---------------------------------------------------------------------------
// op-codes.ts
// ---------------------------------------------------------------------------

export const tagColorSchema = z.object({
  tag: requiredText("Tag is required.", TEXT_LIMITS.tag),
  hue: z
    .number({ error: "Colour must be one of the 8 palette slots." })
    .int({ error: "Colour must be one of the 8 palette slots." })
    .min(0, { error: "Colour must be one of the 8 palette slots." })
    .max(7, { error: "Colour must be one of the 8 palette slots." })
    .nullable(),
});

const subCodeSchema = z.object({
  id: uuidField("Sub op code id").optional(),
  code: freeText(TEXT_LIMITS.opCode).optional().default(""),
  description: freeText(TEXT_LIMITS.description).optional().default(""),
  flagHours: hours("Flag hours", MAX_NUMERIC_5_2),
});

const tagsSchema = z
  .array(freeText(TEXT_LIMITS.tag), { error: "Tags must be a list." })
  .max(50, { error: "That's too many tags." });

export const createOpCodeSchema = z.object({
  code: requiredText("Op code is required.", TEXT_LIMITS.opCode),
  description: freeText(TEXT_LIMITS.description).optional().default(""),
  flagHours: hours("Flag hours", MAX_NUMERIC_5_2),
  notes: freeText(TEXT_LIMITS.notes).optional(),
  tags: tagsSchema.optional(),
  subCodes: z.array(subCodeSchema).max(100, { error: "That's too many sub codes." }).optional(),
});

export const updateOpCodeSchema = z.object({
  id: opCodeIdSchema,
  patch: z.object({
    code: requiredText("Op code is required.", TEXT_LIMITS.opCode).optional(),
    description: freeText(TEXT_LIMITS.description).optional(),
    flagHours: hours("Flag hours", MAX_NUMERIC_5_2).optional(),
    notes: freeText(TEXT_LIMITS.notes).optional(),
    tags: tagsSchema.optional(),
    subCodes: z
      .array(subCodeSchema)
      .max(100, { error: "That's too many sub codes." })
      .optional(),
    removedSubIds: z
      .array(uuidField("Sub op code id"))
      .max(500, { error: "Too many sub codes to remove at once." })
      .optional(),
  }),
});

export const reorderOpCodesSchema = z
  .array(uuidField("Op code id", "All op code ids must be non-empty strings."), {
    error: "Expected an array of op code ids.",
  })
  .max(5000, { error: "Too many op codes to reorder at once." });

// ---------------------------------------------------------------------------
// paid-periods.ts
// ---------------------------------------------------------------------------

export const paidPeriodSchema = z.object({
  periodKey: periodKey(),
  hours: hours("Paid hours", MAX_NUMERIC_6_2),
});

// ---------------------------------------------------------------------------
// ro-template.ts
// ---------------------------------------------------------------------------

const REGION_MESSAGE = "That template region is out of bounds.";

const fieldRegionSchema = z.object({
  field: oneOf(
    ["roNumber", "vehicle", "vin", "opCodes"] as const,
    "Unrecognized template field.",
  ),
  x: z.number({ error: REGION_MESSAGE }).min(0, { error: REGION_MESSAGE }).max(100, { error: REGION_MESSAGE }),
  y: z.number({ error: REGION_MESSAGE }).min(0, { error: REGION_MESSAGE }).max(100, { error: REGION_MESSAGE }),
  width: z.number({ error: REGION_MESSAGE }).min(0, { error: REGION_MESSAGE }).max(100, { error: REGION_MESSAGE }),
  height: z.number({ error: REGION_MESSAGE }).min(0, { error: REGION_MESSAGE }).max(100, { error: REGION_MESSAGE }),
});

/**
 * Template ids are NOT validated as uuids.
 *
 * They're minted client-side and stored inside a JSON array in user_settings,
 * not as a `uuid` column — so unlike every other id in this file, Postgres never
 * had an opinion about their shape. Today's editor uses crypto.randomUUID(), but
 * a row written by an older build is still a row someone needs to delete.
 */
export const templateIdSchema = requiredText("Template ID is required.", 200);

export const roTemplateSchema = z.object({
  id: templateIdSchema,
  name: freeText(TEXT_LIMITS.name).optional().default(""),
  existingStoragePath: storagePath("Invalid template image path.").nullable().optional().default(null),
  regions: z
    .array(fieldRegionSchema, { error: "At least one region is required." })
    .min(1, { error: "At least one region is required." }),
});

// ---------------------------------------------------------------------------
// schedule.ts
// ---------------------------------------------------------------------------

const TIME_MESSAGE = "Shift times must look like 07:30.";
const timeOfDay = z
  .string({ error: TIME_MESSAGE })
  .refine((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v), { error: TIME_MESSAGE });

const BREAK_MESSAGE = "Lunch must be a whole number of minutes.";
const breakMinutes = z
  .number({ error: BREAK_MESSAGE })
  .int({ error: BREAK_MESSAGE })
  .min(0, { error: BREAK_MESSAGE })
  .max(1440, { error: "Lunch can't be longer than a day." });

const shiftDefSchema = z.object({
  start: timeOfDay,
  end: timeOfDay,
  breakMin: breakMinutes,
});

/**
 * An absent day is a day off, not a malformed week.
 *
 * `.default(null)` rather than a required key: the pattern is stored as JSON, so
 * a week written by an older build can be missing a day outright, and "you never
 * worked Saturdays" is what that has always meant.
 */
const day = shiftDefSchema.nullable().optional().default(null);

const scheduleWeekSchema = z.object({
  mon: day,
  tue: day,
  wed: day,
  thu: day,
  fri: day,
  sat: day,
  sun: day,
});

export const workScheduleSchema = z.object({
  effectiveFrom: isoDate("Effective date must be in YYYY-MM-DD format."),
  rotationWeeks: z.union([z.literal(1), z.literal(2)], {
    error: "Rotation must be 1 or 2 weeks.",
  }),
  // The shape only; `validateWeeks` still decides whether the pattern makes
  // sense (right number of weeks, at least one workday, ends after it starts).
  weeks: z
    .array(scheduleWeekSchema, { error: "A schedule needs at least one week." })
    .min(1, { error: "A schedule needs at least one week." })
    .max(2, { error: "Rotation must be 1 or 2 weeks." }),
});

const SHIFT_HOURS_MESSAGE = "Shift hours must be a number.";

export const shiftOverrideSchema = z.object({
  date: isoDate("Date must be in YYYY-MM-DD format."),
  input: z.object({
    // Bounds stay off the hours: `shiftFromHours` is the thing that decides
    // whether a shift is possible, and it already answers with the sentence the
    // user should read.
    paidHours: z
      .number({ error: SHIFT_HOURS_MESSAGE })
      .refine(Number.isFinite, { error: SHIFT_HOURS_MESSAGE }),
    start: timeOfDay,
    breakMin: breakMinutes,
  }),
});

export const scheduleDateSchema = isoDate("Date must be in YYYY-MM-DD format.");

export const resolveZeroDaySchema = z.object({
  date: scheduleDateSchema,
  resolution: oneOf(
    ["day-off", "worked-zero", "worked-unpaid"] as const,
    "Unrecognized resolution.",
  ),
  unpaid: z
    .object({
      hours: z
        .number({ error: "Unpaid hours must be greater than zero." })
        .refine(Number.isFinite, { error: "Unpaid hours must be greater than zero." })
        .gt(0, { error: "Unpaid hours must be greater than zero." })
        .max(24, { error: "Unpaid hours can't exceed 24 in a day." }),
      kind: unpaidTimeKind,
      note: freeText(TEXT_LIMITS.notes).optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// settings.ts
// ---------------------------------------------------------------------------

export const periodOverrideSchema = z
  .object({
    periodKey: periodKey(),
    start: isoDate("Dates must be in YYYY-MM-DD format."),
    end: isoDate("Dates must be in YYYY-MM-DD format."),
  })
  .refine((v) => v.start <= v.end, {
    error: "Start date must be on or before end date.",
    path: ["end"],
  });

export const periodKeySchema = periodKey();

const GOAL_MESSAGE = "Goal hours must be a whole number between 1 and 999.";
export const goalHoursSchema = z
  .number({ error: GOAL_MESSAGE })
  .int({ error: GOAL_MESSAGE })
  .min(1, { error: GOAL_MESSAGE })
  .max(999, { error: GOAL_MESSAGE });

const RATE_RANGE_MESSAGE = "Reference rate must be a number between 0 and 9999.";
export const referenceRateSchema = z
  .number({ error: RATE_RANGE_MESSAGE })
  .refine(Number.isFinite, { error: RATE_RANGE_MESSAGE })
  .min(0, { error: RATE_RANGE_MESSAGE })
  .max(9999, { error: RATE_RANGE_MESSAGE })
  .nullable();

export const shareLaborTimesSchema = z.boolean({
  error: "Sharing preference must be true or false.",
});

const SPLIT_MESSAGE = "Split day must be an integer between 1 and 30.";
export const splitDaySchema = z
  .number({ error: SPLIT_MESSAGE })
  .int({ error: SPLIT_MESSAGE })
  .min(1, { error: SPLIT_MESSAGE })
  .max(30, { error: SPLIT_MESSAGE });

export const weekStartDaySchema = z.union([z.literal(0), z.literal(1)], {
  error: "Week start must be Sunday or Monday.",
});

/**
 * A timezone name, checked for shape before `Intl` is asked whether it exists.
 *
 * This value is written straight into a cookie. `Intl.DateTimeFormat` would
 * reject a nonsense zone on its own, but it runs after the string has already
 * been accepted as a candidate — and a cookie value carrying a newline is a
 * different class of problem than a wrong timezone.
 */
export const timezoneSchema = z
  .string({ error: "Invalid timezone." })
  .max(64, { error: "Invalid timezone." })
  .refine((v) => /^[A-Za-z0-9_+/-]+$/.test(v), { error: "Invalid timezone." });

/**
 * The backup envelope.
 *
 * Row arrays are LOOSE objects: unknown keys pass through untouched. That is
 * load-bearing — a v3 backup carries columns this schema doesn't name, and a
 * strict object would silently drop them on the way to the restore, turning a
 * validation pass into data loss. `buildImportPayload` is the whitelist for
 * what actually reaches the database, field by field, and it is tested.
 *
 * Nothing here is made REQUIRED that wasn't already: a v1 file predates most of
 * these keys, and "absent" is meaningful to the importer (leave the
 * destination's value alone). This only checks that what IS present has the
 * right type, so a hand-edited backup fails with a sentence instead of a
 * Postgres error halfway through the restore RPC.
 */
const looseRows = (label: string) =>
  z.array(z.looseObject({}), { error: `${label} must be a list.` }).optional();

export const importBundleSchema = z.looseObject({
  version: z.number({ error: "That file isn't a Flat Rate Tracker backup." }),
  exportedAt: z.string().optional(),
  settings: z.object({
    // Declared (and therefore stripped to) exactly the fields the importer
    // reads. is_admin is the reason: a backup is a file the user can edit, so a
    // settings shape that accepts a privilege flag is a privilege escalation.
    splitDay: splitDaySchema.optional(),
    periodOverrides: z
      .record(
        z.string(),
        z.object({ start: z.string(), end: z.string() }),
        { error: "Period overrides are malformed." },
      )
      .optional(),
    goalHours: goalHoursSchema.optional(),
    tagColors: z.record(z.string(), z.number()).optional(),
    referenceHourlyRate: z.number().nullable().optional(),
    roTemplates: z.array(z.unknown()).nullable().optional(),
    defaultLaborType: z.string().nullable().optional(),
    shareLaborTimes: z.boolean().optional(),
  }),
  entries: z.array(z.looseObject({}), { error: "Invalid backup format." }),
  opCodes: z.array(z.looseObject({}), { error: "Invalid backup format." }),
  dailyClocks: looseRows("Clock records"),
  paidPeriods: looseRows("Paid periods"),
  entryPhotos: looseRows("Photos"),
  bonuses: looseRows("Spiffs"),
  laborRates: looseRows("Labor rates"),
  disputes: looseRows("Disputes"),
  unpaidTime: looseRows("Unpaid time"),
  workSchedules: looseRows("Schedules"),
  daysOff: looseRows("Days off"),
  shiftOverrides: z.unknown().optional(),
  confirmedZeroDays: z.unknown().optional(),
  portfolioSnapshots: looseRows("Snapshots"),
  careerMilestones: looseRows("Milestones"),
});

// ---------------------------------------------------------------------------
// timer.ts
// ---------------------------------------------------------------------------

export const attachTimerSchema = z.object({
  entryId: uuidField("RO ID", "Pick an RO first."),
  lineId: nullableUuid("Line ID").optional().default(null),
});

export const timerStatusSchema = z.object({
  timerId: timerIdSchema,
  status: timerStatus,
});

export const timerLineSchema = z.object({
  timerId: timerIdSchema,
  lineId: nullableUuid("Line ID"),
});

export const saveTimerSchema = z.object({
  timerId: timerIdSchema,
  lineId: uuidField("Line ID", "Pick an op code to save this time to."),
});
