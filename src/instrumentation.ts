/**
 * Next.js instrumentation hook — runs once, in the server process, before any
 * route module is imported. Under fixture mode it pins the clock.
 *
 * WHY THE GLOBAL Date AND NOT A PARAMETER
 * "Today" is not derived in one place. It's read independently in at least six:
 *
 *   src/lib/periods.ts        isoDate(d = new Date())
 *   src/lib/periods.ts        isoDateInTz(tz, d = new Date())
 *   src/lib/db/gamification.ts  opts.nowMs ?? Date.now()
 *   dashboard/page.tsx        timeAgo() → Date.now()
 *   dashboard/page.tsx        ninetyDaysAgo → Date.now() - 90d
 *   pay-period + dispute-pack  const threeYearsAgo = new Date()
 *
 * Threading a frozen `now` through all of them means touching prod code in six
 * files and leaving a seventh to be added later and silently un-freeze the
 * suite. Overriding the constructor catches every one of them, including any
 * added tomorrow, and changes zero lines of application code.
 *
 * Frozen data alone is not enough to make snapshots stable: the dataset would
 * hold still while "days left in this pay period" counted down underneath it.
 * Both have to be pinned or neither is.
 *
 * This is inert unless FRT_FIXTURE_MODE=1, which is set on the canary container
 * only — never on the app service.
 */
import { FIXTURE_MODE, FIXTURE_NOW_ISO, FIXTURE_NOW_MS } from "@/lib/fixtures/enabled";

export function register() {
  if (!FIXTURE_MODE) return;

  const RealDate = Date;

  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      // Only the zero-arg form means "now". Every other form is an explicit
      // instant and must keep working normally — the fixture data itself builds
      // dates with new Date(ms).
      if (args.length === 0) super(FIXTURE_NOW_MS);
      else super(...(args as ConstructorParameters<typeof Date>));
    }

    static now() {
      return FIXTURE_NOW_MS;
    }
  }

  globalThis.Date = FrozenDate as DateConstructor;

  // Loud on purpose. A container silently in fixture mode would serve frozen
  // data to real users; if this line ever shows up in the app service's logs,
  // that is the bug.
  console.warn(`[FIXTURE MODE] clock pinned to ${FIXTURE_NOW_ISO} — data is frozen, do not serve this to users`);
}
