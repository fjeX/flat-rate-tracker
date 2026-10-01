"use client";

import { useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/Switch";
import { setQuickAddEnabled, useQuickAddEnabled } from "@/lib/quick-add-pref";
import { SettingRow } from "./SettingRow";

const subscribeNoop = () => () => {};

export function QuickAddCard() {
  // Shared with the dashboard's TodayCard through one store, so toggling here
  // moves the floating button immediately instead of on the next reload.
  const enabled = useQuickAddEnabled();
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  return (
    <SettingRow
      titleAs="h2"
      title="Quick Add RO"
      description="Shows a floating “+” button on the dashboard for logging an RO in seconds — just RO number and op code, no extra steps."
    >
      {/* Rendered only after mount: the stored preference lives in
          localStorage, and rendering the default first would flip the switch
          under the user on hydration. */}
      {mounted && <Switch checked={enabled} onChange={setQuickAddEnabled} label="Quick Add RO" />}
    </SettingRow>
  );
}
