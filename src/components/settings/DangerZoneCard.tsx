"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { clearAllDataAction } from "@/app/actions/settings";

const CONFIRM_WORD = "DELETE";

export function DangerZoneCard() {
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClear() {
    startTransition(async () => {
      await clearAllDataAction();
      setInput("");
      setDone(true);
    });
  }

  if (done) {
    return (
      <section className="rounded-xl border border-red-900/60 bg-zinc-900 p-6">
        <p className="text-sm text-zinc-400">All data cleared. Settings reset to defaults.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-red-900/60 bg-zinc-900 p-6">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <h2 className="text-base font-semibold text-red-400">Danger Zone</h2>
      </div>
      <p className="mb-5 text-sm text-zinc-400">
        Permanently deletes all repair orders, op codes, clocked hours, and pay period records.
        Resets split day to 15 and clears all overrides. This cannot be undone.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Type ${CONFIRM_WORD} to confirm`}
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-red-800 focus:outline-none"
        />
        <button
          onClick={handleClear}
          disabled={input !== CONFIRM_WORD || pending}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Clearing…" : "Clear all data"}
        </button>
      </div>
    </section>
  );
}
