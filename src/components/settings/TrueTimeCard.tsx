"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setShareLaborTimesAction } from "@/app/actions/settings";
import { Switch } from "@/components/ui/Switch";
import { actionErrorMessage } from "@/lib/action-error";
import { SettingRow } from "./SettingRow";

/**
 * True Time consent. ON by default for accounts created on/after 2026-10-01
 * (opt-out; it was opt-in before — see 20261001000000_true_time_default_on.sql),
 * which raises the bar on the copy rather than lowering it: a tech who never
 * asked for this has to be able to see at a glance what is leaving and how to
 * stop it.
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
        setError(actionErrorMessage(e, "Couldn't save that."));
      }
    });
  }

  return (
    <SettingRow
      titleAs="h2"
      title="Contribute to True Time"
      description={
        <>
          Book times were written for cars that didn&apos;t have scan tools. True
          Time pools what jobs <em>actually</em> take, measured by techs in the
          bay, so you can tell which op codes really pay. It&apos;s on for new
          accounts. While it&apos;s on, FRT shares the op code, the vehicle, the
          book hours, and your actual hours — nothing else. No RO numbers, no
          customer info, no shop name, no name of yours, and no date finer than
          the month. Turn it off any time and everything you&apos;ve contributed
          is deleted.
        </>
      }
      fine="Pooled figures are only ever shown once at least 5 different techs have logged the same job, so nothing can be traced back to one person."
    >
      <Switch checked={share} onChange={toggle} disabled={isPending} label="Contribute to True Time" />
      {error && <p role="alert" className="stg-note is-bad">{error}</p>}
    </SettingRow>
  );
}
