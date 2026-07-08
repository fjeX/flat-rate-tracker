"use client";

// Guest mode's stand-in for the full Pay Rates card: a single flat rate, no
// labor types. It's just enough to preview the dollar figures a signed-in user
// unlocks with per-type rates. Persists via the guest store (sessionStorage).
import { useState } from "react";
import { useGuestStore } from "@/lib/guest/context";

export function GuestRateCard() {
  const { hourlyRate, setGuestRate } = useGuestStore();
  const [val, setVal] = useState(hourlyRate !== null ? String(hourlyRate) : "");

  function commit() {
    const trimmed = val.trim();
    if (trimmed === "") {
      setGuestRate(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setGuestRate(parsed);
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--fg-2)]">Your rate</span>
      <span className="flex items-center rounded-md border border-[var(--line)] bg-[var(--bg-1)] pl-2">
        <span className="text-[var(--fg-3)]">$</span>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="—"
          aria-label="Your hourly flat-rate pay"
          className="w-16 bg-transparent px-1 py-1.5 text-right font-mono text-sm text-[var(--fg-0)] placeholder-[var(--fg-3)] focus:outline-none"
        />
        <span className="pr-2 text-xs text-[var(--fg-3)]">/hr</span>
      </span>
    </label>
  );
}
