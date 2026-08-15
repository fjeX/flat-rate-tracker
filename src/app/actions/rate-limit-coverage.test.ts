// Coverage gate: the endpoints that cost money or can be abused must be rate
// limited, and must STAY rate limited.
//
// WHY A SOURCE-READING GATE RATHER THAN UNIT TESTS
// The failure mode of this layer is not a wrong limit — it is an action that
// quietly stops calling the limiter (a refactor, a rewritten early-return, a new
// action that spends money and nobody wired). From the outside that looks
// identical to a limited action right up until the bill arrives. A test that
// imports the action can't see the omission either, because a "use server"
// module needs a request context to run at all.
//
// Related: src/lib/validation/actions.test.ts does the same thing for zod.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIONS_DIR = join(process.cwd(), "src/app/actions");

/**
 * Actions that MUST call the limiter, and why they earn a limit.
 * Adding an endpoint that spends money or writes storage means adding it here.
 */
const MUST_BE_LIMITED: Array<{ file: string; action: string; because: string }> = [
  // Auth — anonymous, brute-forceable.
  { file: "auth.ts", action: "signUp", because: "spam signups + confirmation mail" },
  { file: "auth.ts", action: "signIn", because: "password brute force" },
  { file: "auth.ts", action: "requestPasswordReset", because: "mail bombing an inbox" },
  // Money — every call hands work to a headless Claude run.
  { file: "bug-reports.ts", action: "submitBugReport", because: "fires the Claude triage webhook" },
  { file: "bug-reports.ts", action: "setBugTriage", because: "Verify fires the Claude investigate webhook" },
  // Email sends.
  { file: "account.ts", action: "updateEmail", because: "GoTrue mails old AND new address" },
  // Storage growth.
  { file: "entry-photos.ts", action: "uploadEntryPhoto", because: "unbounded storage writes" },
  // Heaviest DB work in the app.
  { file: "settings.ts", action: "exportDataAction", because: "serialises every table the user owns" },
  { file: "settings.ts", action: "importDataAction", because: "rewrites every table the user owns" },
  { file: "settings.ts", action: "clearAllDataAction", because: "destructive full wipe" },
];

/**
 * Extract one exported action's body from a module's source.
 * Returns null when the action isn't found, which the caller treats as a
 * failure — a renamed action must not silently pass this gate.
 */
export function actionBody(source: string, name: string): string | null {
  const head = source.indexOf(`export async function ${name}(`);
  if (head === -1) return null;

  // Step 1: walk the parameter list to its matching paren. A parameter can
  // contain parens of its own (`{ a }: { a: () => void }`).
  const paren = source.indexOf("(", head);
  let parenDepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")" && --parenDepth === 0) {
      afterParams = i + 1;
      break;
    }
  }
  if (afterParams === -1) return null;

  // Step 2: find the brace that OPENS THE BODY, which is not simply the next
  // brace in the file. A return annotation like `Promise<{ error?: string }>`
  // gets there first, and matching from it returns the annotation as the body —
  // an action would then look unlimited no matter what it actually calls.
  // Tracking angle-bracket depth skips anything living inside a type argument.
  let angle = 0;
  let open = -1;
  for (let i = afterParams; i < source.length; i++) {
    const ch = source[i];
    if (ch === "<") angle++;
    else if (ch === ">") angle = Math.max(0, angle - 1);
    else if (ch === "{" && angle === 0) {
      open = i;
      break;
    }
  }
  if (open === -1) return null;

  // Step 3: walk to the matching close brace, so a nested object or closure
  // inside the body doesn't end it early.
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return null;
}

function callsLimiter(body: string): boolean {
  return /\b(rateLimit|rateLimitAll|enforceRateLimit)\(/.test(body);
}

describe("rate-limit coverage gate", () => {
  it("actually detects an unlimited action", () => {
    // "All clear" is an empty failure list, which is also what a broken matcher
    // produces. Pin it against sources where it MUST fire and must not.
    const unlimited = `
export async function spendMoney(id: string): Promise<void> {
  await fireBugWebhook(url, id);
}
`;
    const limited = `
export async function spendMoney(id: string): Promise<void> {
  await enforceRateLimit("b", id, LIMITS.x, "slow down");
  await fireBugWebhook(url, id);
}
`;
    // A body containing the word but not the call must not count.
    const mentionsOnly = `
export async function spendMoney(id: string): Promise<void> {
  // TODO: add enforceRateLimit here
  await fireBugWebhook(url, id);
}
`;
    expect(callsLimiter(actionBody(unlimited, "spendMoney")!)).toBe(false);
    expect(callsLimiter(actionBody(limited, "spendMoney")!)).toBe(true);
    expect(callsLimiter(actionBody(mentionsOnly, "spendMoney")!)).toBe(false);
    expect(actionBody(unlimited, "renamedAway")).toBeNull();
  });

  it("skips an inline-object RETURN TYPE to find the real body", () => {
    // The first `{` after the signature belongs to `Promise<{ ... }>`, not to
    // the body. Matching from it returns the annotation, which contains no
    // limiter call — so a properly limited action reads as unlimited and the
    // gate fails for a reason that has nothing to do with the code. Caught for
    // real on updateEmail while wiring this up.
    const source = `
export async function updateEmail(
  formData: FormData,
): Promise<{ error?: string; message?: string }> {
  await rateLimitAll([{ bucket: "b", identifier: "x", rule: r }]);
  return {};
}
`;
    const body = actionBody(source, "updateEmail")!;
    expect(callsLimiter(body)).toBe(true);
    expect(body).toContain("rateLimitAll");
  });

  it("stops at the action's own closing brace, not the first one it sees", () => {
    const source = `
export async function first(id: string): Promise<void> {
  const shape = { nested: { deeper: true } };
  await enforceRateLimit("b", id, LIMITS.x, "slow down");
}

export async function second(): Promise<void> {
  await somethingElse();
}
`;
    const body = actionBody(source, "first")!;
    expect(callsLimiter(body)).toBe(true);
    // If brace matching were naive, `second`'s body would be swept in here and
    // an unlimited action could inherit its neighbour's limiter call.
    expect(body).not.toContain("somethingElse");
  });

  for (const { file, action, because } of MUST_BE_LIMITED) {
    it(`${file} → ${action} (${because})`, () => {
      const source = readFileSync(join(ACTIONS_DIR, file), "utf8");
      const body = actionBody(source, action);
      expect(body, `${action} not found in ${file} — renamed or removed?`).not.toBeNull();
      expect(
        callsLimiter(body!),
        `${action} spends resources (${because}) but never calls the rate limiter`,
      ).toBe(true);
    });
  }

  it("guards the webhook poster itself", () => {
    // fireBugWebhook is the function that actually spends money. Every call site
    // must sit behind a limiter, so a new one added without a gate is caught
    // here rather than on the invoice.
    const source = readFileSync(join(ACTIONS_DIR, "bug-reports.ts"), "utf8");
    const callSites = source.match(/await fireBugWebhook\(/g) ?? [];
    expect(callSites.length).toBeGreaterThan(0);
    // Both known call sites live in actions the table above already pins.
    expect(callSites).toHaveLength(2);
  });
});
