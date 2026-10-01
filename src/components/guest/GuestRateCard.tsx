"use client";

// Guest mode's stand-in for the full Pay Rates card: a single flat rate, no
// labor types. It's just enough to preview the dollar figures a signed-in user
// unlocks with per-type rates. Persists via the guest store (sessionStorage).
// The shared field look: Field + .input.num, with the $ and /hr set inside it.
import { useState } from "react";
import { useGuestStore } from "@/lib/guest/context";
import { Field } from "@/components/ui/Field";

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
    <Field label="Your rate" htmlFor="guest-rate" className="gst-rate-field">
      <span className="gst-rate">
        <span className="gst-rate-pre" aria-hidden="true">$</span>
        <input
          id="guest-rate"
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
          className="input num"
        />
        <span className="gst-rate-unit" aria-hidden="true">/hr</span>
      </span>
    </Field>
  );
}
