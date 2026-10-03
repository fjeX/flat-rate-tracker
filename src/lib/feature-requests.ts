// Shared constants + literals for the Request-a-Feature feature. Kept out of the
// "use server" action module because that file may only export async functions.

export const MAX_FEATURE_DESCRIPTION_CHARS = 4000;

// Admin-set lifecycle. Mirrors the CHECK constraint in
// 20261002000000_feature_requests.sql — change both together.
export const FEATURE_STATUSES = [
  "New",
  "Reviewing",
  "Planned",
  "In Progress",
  "Shipped",
  "Not Planned",
] as const;

export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

// Statuses the inbox's default "Open" filter hides: the request has an answer.
export const CLOSED_FEATURE_STATUSES: readonly FeatureStatus[] = ["Shipped", "Not Planned"];

// ── Replies (closing the loop) ────────────────────────────────────────────────
// What a reply is, decided server-side from the submission's SAVED status:
// a Resolved bug gets a "fixed" thank-you, a Shipped request a "shipped" one,
// anything else a plain "note". Mirrors the CHECK in 20261002010000.
export const REPLY_KINDS = ["fixed", "shipped", "note"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export const MAX_REPLY_CHARS = 4000;

export function replyKindFor(source: "bug" | "feature", savedStatus: string): ReplyKind {
  if (source === "bug" && savedStatus === "Resolved") return "fixed";
  if (source === "feature" && savedStatus === "Shipped") return "shipped";
  return "note";
}

/** The starter text behind the admin's "Write a thank-you" button. Always
 *  editable before it's sent; null for a plain note (nothing to thank for yet). */
export function thankYouTemplate(kind: ReplyKind, firstName: string | null): string | null {
  const hey = firstName ? `Hey ${firstName}, ` : "Hey, ";
  if (kind === "fixed") {
    return `${hey}the bug you reported is fixed and live now. Thanks for taking the time to send it in. Every report like yours makes FRT better for every tech who uses it.`;
  }
  if (kind === "shipped") {
    return `${hey}your idea made it into the app, and it's live now. Thanks for taking the time to send it in. FRT is built from what techs actually need, and you just made it better for everybody who uses it.`;
  }
  return null;
}
