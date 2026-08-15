"use client";

import { useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/Switch";
import { setQuickAddEnabled, useQuickAddEnabled } from "@/lib/quick-add-pref";

const subscribeNoop = () => () => {};

export function QuickAddCard() {
  // Shared with the dashboard's TodayCard through one store, so toggling here
  // moves the floating button immediately instead of on the next reload.
  const enabled = useQuickAddEnabled();
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  function handleToggle(next: boolean) {
    setQuickAddEnabled(next);
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

        {/* Rendered only after mount: the stored preference lives in
            localStorage, and rendering the default first would flip the switch
            under the user on hydration. */}
        {mounted && (
          <Switch
            checked={enabled}
            onChange={handleToggle}
            label={enabled ? "Disable quick add" : "Enable quick add"}
          />
        )}
      </div>
    </section>
  );
}
