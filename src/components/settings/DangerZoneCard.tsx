"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { clearAllDataAction } from "@/app/actions/settings";
import { tap } from "@/lib/haptics";

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
        setError(err instanceof Error ? err.message : "Couldn't clear data — check your connection and try again.");
      }
    });
  }

  const dangerBorderStyle = { borderColor: "color-mix(in oklab, var(--bad) 30%, var(--line))" } as const;

  if (done) {
    return (
      <section className="card padded-lg" style={dangerBorderStyle}>
        <p className="text-sm" style={{ color: "var(--fg-2)" }}>All data cleared. Settings reset to defaults.</p>
      </section>
    );
  }

  return (
    <section className="card padded-lg" style={dangerBorderStyle}>
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" style={{ color: "var(--bad)" }} />
        <h2 className="text-base font-semibold" style={{ color: "var(--bad)" }}>Danger Zone</h2>
      </div>
      <p className="mb-5 text-sm" style={{ color: "var(--fg-2)" }}>
        Permanently deletes all repair orders, op codes, clocked hours, and pay period records.
        Resets split day to 15 and clears all overrides. This cannot be undone.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="danger-confirm" className="sr-only">
          Type {CONFIRM_WORD} to confirm deletion
        </label>
        <input
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
          className="input flex-1"
          style={{ borderColor: "color-mix(in oklab, var(--bad) 35%, var(--line))" }}
        />
        <button
          onClick={handleClear}
          disabled={input !== CONFIRM_WORD || pending}
          className="btn"
          style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "color-mix(in oklab, var(--bad) 40%, transparent)" }}
        >
          {pending ? "Clearing…" : "Clear all data"}
        </button>
      </div>
      <p id="danger-hint" className="mt-2 text-xs" style={{ color: "var(--fg-3)" }}>
        This cannot be undone.
      </p>
      {error && (
        <p id="danger-error" role="alert" className="mt-2 text-sm" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
