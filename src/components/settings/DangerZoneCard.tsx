"use client";

import { useState, useTransition } from "react";
import { clearAllDataAction } from "@/app/actions/settings";
import { tap } from "@/lib/haptics";
import { actionErrorMessage } from "@/lib/action-error";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusField } from "@/components/ui/StatusField";
import { SettingRow } from "./SettingRow";

const CONFIRM_WORD = "DELETE";

export function DangerZoneCard() {
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClear() {
    tap();
    setError(null);
    startTransition(async () => {
      try {
        await clearAllDataAction();
        setInput("");
        setDone(true);
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't clear data — check your connection and try again."));
      }
    });
  }

  if (done) {
    return (
      <SettingRow titleAs="h2" title="Danger Zone" tone="bad">
        <StatusField tag="Saved" inset>All data cleared. Settings reset to defaults.</StatusField>
      </SettingRow>
    );
  }

  return (
    <SettingRow
      titleAs="h2"
      title="Danger Zone"
      tone="bad"
      wide
      description="Permanently deletes all repair orders, op codes, clocked hours, and pay period records. Resets split day to 15 and clears all overrides. This cannot be undone."
    >
      <div className="stg-danger">
        <label htmlFor="danger-confirm" className="sr-only">
          Type {CONFIRM_WORD} to confirm deletion
        </label>
        <Input
          id="danger-confirm"
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          placeholder={`Type ${CONFIRM_WORD} to confirm`}
          aria-required="true"
          aria-invalid={input.length > 0 && input !== CONFIRM_WORD}
          aria-describedby={error ? "danger-error" : "danger-hint"}
        />
        <Button variant="danger" onClick={handleClear} disabled={input !== CONFIRM_WORD || pending}>
          {pending ? "Clearing…" : "Clear all data"}
        </Button>
      </div>
      <p id="danger-hint" className="stg-note">This cannot be undone.</p>
      {error && (
        <p id="danger-error" role="alert" className="stg-note is-bad">
          {error}
        </p>
      )}
    </SettingRow>
  );
}
