/**
 * A refusal is an error written FOR the tech: "That RO is already on a timer",
 * "Photo too large", "would leave 3 days in no pay period". It is the one kind
 * of thrown error whose message must reach the screen verbatim.
 *
 * WHY THIS EXISTS (server-action-thrown-refusals-masked, 2026-10-01)
 * A production Next.js build replaces the message of ANY error thrown from a
 * Server Action with "An error occurred in the Server Components render" plus
 * a digest; only the server log keeps the sentence. So a refusal thrown from an
 * action reads as an opaque failure on the live site — in dev it looks fine,
 * which is why ~22 of them shipped that way. The cure is that an action never
 * lets a refusal escape: it returns `{ error }` and the caller renders it.
 *
 * Pattern:
 *   - deep helpers throw `new Refusal("sentence")` where the logic lives;
 *   - each action boundary is wrapped in `refusable(async () => {...})`, which
 *     turns a Refusal into `{ error }` and rethrows everything else (a genuine
 *     bug must stay loud and reach the error boundary / server log);
 *   - internal invariants and auth guards keep throwing plain Error.
 *
 * `ImportRefusal` (import-remap.ts) predates this and does the same job for
 * the importer; it is left alone.
 */
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refusal";
  }
}

export function isRefusal(err: unknown): err is Refusal {
  return err instanceof Refusal;
}

/** `{ error }` when `err` is a Refusal, otherwise rethrow. */
export function refusalToResult(err: unknown): { error: string } {
  if (isRefusal(err)) return { error: err.message };
  throw err;
}

/**
 * Run an action body; a thrown Refusal becomes `{ error }`, anything else
 * propagates. `T` is the success shape (often `{}` or `{ ok: true }`).
 */
export async function refusable<T extends object>(
  body: () => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await body();
  } catch (err) {
    return refusalToResult(err);
  }
}
