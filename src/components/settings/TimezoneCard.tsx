"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTimezoneAction } from "@/app/actions/settings";
import { useClientValue } from "@/lib/client-storage";
import { actionErrorMessage } from "@/lib/action-error";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SettingRow } from "./SettingRow";

const TIMEZONES = [
  { label: "Eastern (ET) — New York", value: "America/New_York" },
  { label: "Central (CT) — Chicago", value: "America/Chicago" },
  { label: "Mountain (MT) — Denver", value: "America/Denver" },
  { label: "Arizona (MST, no DST)", value: "America/Phoenix" },
  { label: "Pacific (PT) — Los Angeles", value: "America/Los_Angeles" },
  { label: "Alaska (AKT)", value: "America/Anchorage" },
  { label: "Hawaii (HT)", value: "Pacific/Honolulu" },
];

// Module scope so the reference is stable, and it returns the same string on
// every call — both required of a useClientValue reader.
const detectTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function TimezoneCard({ initialTimezone }: { initialTimezone: string }) {
  const router = useRouter();
  // The browser's timezone is a client-only fact: on the server this resolves
  // to the VM's zone, which is not the tech's. "" until hydration, then the
  // real one, so the server never renders a zone it is guessing at.
  const detected = useClientValue(detectTimezone, "");
  // Null means "not chosen in this session" — fall back to the saved cookie,
  // then to what the browser reports.
  const [chosen, setChosen] = useState<string | null>(null);
  const tz = chosen ?? (initialTimezone || detected);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: string) {
    setSaved(false);
    setError(null);
    setChosen(next);
    startTransition(async () => {
      try {
        await setTimezoneAction(next);
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't save — check your connection and try again."));
      }
    });
  }

  const isInList = TIMEZONES.some((t) => t.value === tz);

  return (
    <SettingRow
      titleAs="h2"
      title="Timezone"
      description="Sets what “today” means for your dashboard. If your ROs disappear partway through your shift, set this to your local timezone."
    >
      <div className="stg-inline">
        <Field label="Timezone" htmlFor="timezone-select">
          <select
            id="timezone-select"
            value={isInList ? tz : ""}
            onChange={(e) => save(e.target.value)}
            disabled={pending}
            aria-describedby={error ? "timezone-error" : undefined}
            className="input"
          >
            {!isInList && tz && <option value="">{tz}</option>}
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Button
          variant="quiet"
          disabled={pending}
          onClick={() => save(Intl.DateTimeFormat().resolvedOptions().timeZone)}
        >
          Auto-detect
        </Button>
      </div>
      {error && (
        <p id="timezone-error" role="alert" className="stg-note is-bad">
          {error}
        </p>
      )}
      <p role="status" className="stg-note">
        {tz && (
          <>
            Current: {tz}
            {saved && (
              <>
                {" "}
                <Badge tone="good">Saved</Badge>
              </>
            )}
          </>
        )}
      </p>
    </SettingRow>
  );
}
