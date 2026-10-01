"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTrackRoTimeAction } from "@/app/actions/settings";
import { Switch } from "@/components/ui/Switch";
import { actionErrorMessage } from "@/lib/action-error";
import { SettingRow } from "./SettingRow";

/**
 * The RO time-of-day switch. Off by default.
 *
 * The copy names the case where this is worth nothing — logging the whole day's
 * paperwork in one sitting — because that is most techs, and a timestamp taken
 * then records when the pen moved, not when the work happened. Better to say so
 * than to let someone turn it on and quietly collect twelve identical times.
 */
export function RoTimeCard({ initialTrack }: { initialTrack: boolean }) {
  const router = useRouter();
  const [track, setTrack] = useState(initialTrack);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    // Optimistic, reverted on failure so the switch can never show a state the
    // server refused.
    setTrack(next);
    startTransition(async () => {
      try {
        await setTrackRoTimeAction(next);
        router.refresh();
      } catch (e) {
        setTrack(!next);
        setError(actionErrorMessage(e, "Couldn't save that."));
      }
    });
  }

  return (
    <SettingRow
      titleAs="h2"
      title="Time of day on each RO"
      description={
        <>
          Adds a time field to the log form, filled in with the current time in
          your timezone and editable before you save. It shows on the RO in your
          lists, so a day reads as a sequence of jobs instead of a pile. Worth it
          only if you log ROs as you finish them. If you write up the whole day at
          once, every RO gets stamped with the time you sat down — which tells you
          nothing. Leave this off in that case.
        </>
      }
      fine="Turning it off stops new ROs recording a time. Times already on your ROs stay exactly where they are."
    >
      {/* MUST match the visible heading above, word for word. This is the
          switch's only accessible name, and a name that doesn't contain the
          label a user can see is a WCAG 2.5.3 (Label in Name) failure. */}
      <Switch checked={track} onChange={toggle} disabled={isPending} label="Time of day on each RO" />
      {error && <p role="alert" className="stg-note is-bad">{error}</p>}
    </SettingRow>
  );
}
