"use client";

import { useState, useTransition } from "react";
import { setGoalHoursAction } from "@/app/actions/settings";
import { actionErrorMessage } from "@/lib/action-error";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SettingRow } from "./SettingRow";

export function GoalHoursCard({ initialGoalHours }: { initialGoalHours: number }) {
  const [inputVal, setInputVal] = useState(String(initialGoalHours));
  const [committed, setCommitted] = useState(initialGoalHours);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseInt(inputVal, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 999;
  const dirty = valid && parsed !== committed;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setError(null);
    startTransition(async () => {
      try {
        await setGoalHoursAction(parsed);
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
      title="Pay Period Goal"
      description="Target flag hours per pay period. Drives the pace bar on the dashboard and the chart reference line in history."
    >
      <form onSubmit={handleSubmit} className="stg-inline">
        <Field label="Goal hours" htmlFor="goalHours">
          <Input
            id="goalHours"
            type="number"
            min={1}
            max={999}
            required
            aria-required="true"
            mono
            className="is-hrs"
            value={inputVal}
            onChange={(e) => {
              setInputVal(e.target.value);
              setSaved(false);
              setError(null);
            }}
            aria-invalid={!valid}
            aria-describedby={error ? "goalHours-error" : undefined}
          />
        </Field>
        <Button type="submit" variant="go" disabled={!dirty || pending} saved={saved}>
          {pending ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </Button>
        {error && (
          <p id="goalHours-error" role="alert" className="stg-note is-bad" style={{ flexBasis: "100%" }}>
            {error}
          </p>
        )}
      </form>
    </SettingRow>
  );
}
