"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTrackRoTimeAction } from "@/app/actions/settings";
import { Switch } from "@/components/ui/Switch";

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
            Time of day on each RO
          </h2>
          <p className="text-sm" style={{ color: "var(--fg-2)" }}>
            Adds a time field to the log form, filled in with the current time in
            your timezone and editable before you save. It shows on the RO in
            your lists, so a day reads as a sequence of jobs instead of a pile.
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--fg-2)" }}>
            Worth it only if you log ROs as you finish them. If you write up the
            whole day at once, every RO gets stamped with the time you sat down —
            which tells you nothing. Leave this off in that case.
          </p>
          <p className="mt-2 text-xs" style={{ color: "var(--fg-3)" }}>
            Turning it off stops new ROs recording a time. Times already on your
            ROs stay exactly where they are.
          </p>
          {error && <p className="mt-2 text-xs text-[var(--bad)]">{error}</p>}
        </div>

        <Switch
          checked={track}
          onChange={toggle}
          disabled={isPending}
          label={
            track ? "Stop recording a time on each RO" : "Record a time on each RO"
          }
        />
      </div>
    </section>
  );
}
