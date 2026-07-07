"use client";

import { useEffect, useState } from "react";

const KEY = "frt:quick_add_enabled";

export function QuickAddCard() {
  const [enabled, setEnabled] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored === "false") setEnabled(false);
    setMounted(true);
  }, []);

  function handleToggle(next: boolean) {
    setEnabled(next);
    localStorage.setItem(KEY, String(next));
  }

  return (
    <section className="card padded-lg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--fg-0)" }}>Quick Add RO</h2>
          <p className="text-sm" style={{ color: "var(--fg-2)" }}>
            Shows a floating &ldquo;+&rdquo; button on the dashboard for logging an RO in seconds — just RO number and op code, no extra steps.
          </p>
        </div>

        {/* Toggle switch */}
        {mounted && (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => handleToggle(!enabled)}
            className="relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ background: enabled ? "var(--brand)" : "var(--bg-4)" }}
            aria-label={enabled ? "Disable quick add" : "Enable quick add"}
          >
            <span
              className="pointer-events-none inline-block h-5 w-5 transform rounded-full shadow transition-transform"
              style={{ background: "var(--fg-0)", transform: `translateX(${enabled ? "20px" : "0px"})` }}
            />
          </button>
        )}
      </div>
    </section>
  );
}
