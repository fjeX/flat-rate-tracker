"use client";

// Appearance for guests: lives in the guest directory dialog (there is no guest
// Settings page) and saves to this browser only. The dialog mounts its body only
// while open, so reading <html> here never runs on the server; the head script
// has already put the browser's choice there.
import { AppearanceCard } from "@/components/settings/AppearanceCard";
import { parseAccent, parseTheme } from "@/lib/theme";

export function GuestAppearance() {
  const root = document.documentElement;
  return (
    <AppearanceCard
      mode="guest"
      compact
      initialTheme={parseTheme(root.dataset.theme)}
      initialAccent={parseAccent(root.dataset.accent)}
    />
  );
}
