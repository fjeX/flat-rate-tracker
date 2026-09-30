"use client";

import { useState, useTransition } from "react";
import { setSplitDayAction } from "@/app/actions/settings";
import { getRangeForPeriodKey, formatPeriodLabel, isoDate } from "@/lib/periods";
import { actionErrorMessage } from "@/lib/action-error";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SettingRow } from "./SettingRow";

interface Props {
  initialSplitDay: number;
  overrideCount: number;
}

function buildPreview(splitDay: number) {
  const today = isoDate();
  const [y, m] = today.split("-");
  const key = `${y}-${m}`;
  return {
    p1: getRangeForPeriodKey(`${key}-P1`, splitDay),
    p2: getRangeForPeriodKey(`${key}-P2`, splitDay),
  };
}

export function SplitDayCard({ initialSplitDay, overrideCount }: Props) {
  const [saved, setSaved] = useState(false);
  const [inputVal, setInputVal] = useState(String(initialSplitDay));
  const [committed, setCommitted] = useState(initialSplitDay);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseInt(inputVal, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 30;
  const preview = valid ? buildPreview(parsed) : null;
  const dirty = valid && parsed !== committed;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    startTransition(async () => {
      try {
        await setSplitDayAction(parsed);
        setCommitted(parsed);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't save — check your connection and try again."));
      }
    });
  }

  return (
    <SettingRow
      titleAs="h2"
      title="Pay Period Defaults"
      wide
      description="The day of the month that ends the first pay period (P1). P2 runs from the next day through end of month."
      fine={
        overrideCount > 0 ? (
          <>
            {overrideCount} custom override{overrideCount !== 1 ? "s" : ""} in effect —{" "}
            <a href="/pay-period">manage on the Pay Period tab</a>.
          </>
        ) : undefined
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="stg-inline">
          <Field label="First period ends on day" htmlFor="splitDay">
            <Input
              id="splitDay"
              type="number"
              min={1}
              max={30}
              required
              aria-required="true"
              mono
              className="is-day"
              value={inputVal}
              onChange={(e) => {
                setSaved(false);
                setError(null);
                setInputVal(e.target.value);
              }}
              aria-invalid={!valid}
              aria-describedby={error ? "splitDay-error" : undefined}
            />
          </Field>
          <Button type="submit" variant="go" disabled={!dirty || pending} saved={saved}>
            {pending ? "Saving…" : saved ? "Saved!" : "Save"}
          </Button>
        </div>
        {error && (
          <p id="splitDay-error" role="alert" className="stg-note is-bad">
            {error}
          </p>
        )}
        {preview && (
          <div className="stg-preview">
            <div>
              <span className="stg-k">P1</span>
              <p>{preview.p1 ? formatPeriodLabel(preview.p1) : "—"}</p>
            </div>
            <div>
              <span className="stg-k">P2</span>
              <p>{preview.p2 ? formatPeriodLabel(preview.p2) : "—"}</p>
            </div>
          </div>
        )}
      </form>
    </SettingRow>
  );
}
