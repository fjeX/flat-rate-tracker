// Shared constants + literals for the Report-a-Bug feature. Kept out of the
// "use server" action module because that file may only export async functions.

// Per-report screenshot cap. Enforced in the server action; surfaced in the UI
// to disable the attach control at the limit.
export const MAX_BUG_PHOTOS = 3;

// Hard per-file backstop (5 MB). The client downscales screenshots before upload,
// so real files land well under this; it just rejects anything that skipped
// compression. Matches the bug-photos bucket's file_size_limit.
export const MAX_BUG_PHOTO_BYTES = 5_242_880; // 5 MB

export const MAX_BUG_DESCRIPTION_CHARS = 4000;

// Triage vocabularies. The reporter never sees these — they're the axes the
// admin (or the instant-triage automation) tags a report along.
export const BUG_SEVERITIES = ["Critical", "High", "Low"] as const;
export const BUG_CATEGORIES = ["Visual", "Functional", "Data", "Performance"] as const;
export const BUG_STATUSES = [
  "New",
  "Triaged",
  "Verify",
  "Investigating",
  "Fix Proposed",
  "Resolved",
  "Won't Fix",
  "Needs Info",
] as const;

export type BugSeverity = (typeof BUG_SEVERITIES)[number];
export type BugCategory = (typeof BUG_CATEGORIES)[number];
export type BugStatus = (typeof BUG_STATUSES)[number];
