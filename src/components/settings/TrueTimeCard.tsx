"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setShareLaborTimesAction } from "@/app/actions/settings";

/**
 * True Time consent. Off by default, and the copy has to earn the yes.
 *
 * Two things are stated plainly rather than buried, because this is the only
 * place in FRT where a tech's data leaves their own account: what is sent (a job
 * code, the vehicle, book hours vs. actual hours) and what is not (RO numbers,
 * names, shop, dates finer than the month). Turning it off deletes what was
 * already contributed — see setShareLaborTimesAction.
 */
export function TrueTimeCard({ initialShare }: { initialShare: boolean }) {
  const router = useRouter();
  const [share, setShare] = useState(initialShare);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    // Optimistic, then reconciled by the refresh. Reverted on failure so the
    // switch can never sit in a state the server didn't accept.
    setShare(next);
    startTransition(async () => {
      try {
        await setShareLaborTimesAction(next);
        router.refresh();
      } catch (e) {
        setShare(!next);
        setError(e instanceof Error ? e.message : "Couldn't save that.");
      }
    });
  }

  return (
    <section className="card padded-lg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="mb-1 text-base font-semibold"
            style={{ color: "var(--fg-0)" }}
          >
            Contribute to True Time
          </h2>
          <p className="text-sm" style={{ color: "var(--fg-2)" }}>
            Book times were written for cars that didn&apos;t have scan tools.
            True Time pools what jobs <em>actually</em> take, measured by techs in
            the bay, so you can tell which op codes really pay.
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--fg-2)" }}>
            If you turn this on, FRT shares the op code, the vehicle, the book
            hours, and your actual hours — nothing else. No RO numbers, no
            customer info, no shop name, no name of yours, and no date finer than
            the month. Turn it off and everything you&apos;ve contributed is
            deleted.
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--fg-3)" }}>
            Pooled figures are only ever shown once at least 5 different techs
            have logged the same job, so nothing can be traced back to one
            person.
          </p>
          {error && (
            <p className="mt-2 text-xs text-[var(--bad)]">{error}</p>
          )}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={share}
          disabled={isPending}
          onClick={() => toggle(!share)}
          className="relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 after:absolute after:-inset-2.5 after:content-['']"
          style={{ background: share ? "var(--brand)" : "var(--bg-4)" }}
          aria-label={
            share ? "Stop contributing to True Time" : "Contribute to True Time"
          }
        >
          <span
            className="pointer-events-none inline-block h-5 w-5 transform rounded-full shadow transition-transform"
            style={{
              background: "var(--fg-0)",
              transform: `translateX(${share ? "20px" : "0px"})`,
            }}
          />
        </button>
      </div>
    </section>
  );
}
