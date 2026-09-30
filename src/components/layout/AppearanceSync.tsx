"use client";

// Sign-in sync for theme + accent: once per user per browser, the account's
// saved look is written into localStorage (the copy the <head> script paints
// from). After that the browser's own value stands, so a local change made
// before it has been saved to the account is never clobbered on a page load.
// A different user signing in on the same browser gets a fresh sync.
//
// One exception, for the accounts that existed before appearance was saved to
// the account: their row reads the column defaults (dark / blue) whether or not
// anyone chose them, while the browser may hold a real choice made with the old
// Account toggle. Overwriting it would flip every Light user to Dark on their
// first visit. So when the account is still at the defaults and this browser
// holds something else, the browser's look is saved UP to the account instead.
import { useEffect } from "react";
import { saveAppearance } from "@/app/actions/appearance";
import { writeStored } from "@/lib/client-storage";
import { APPEARANCE_SYNCED_KEY } from "@/lib/appearance-sync";
import {
  ACCENT_KEY,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  THEME_KEY,
  applyThemeToRoot,
  parseAccent,
  parseTheme,
  type Accent,
  type Theme,
} from "@/lib/theme";

export function AppearanceSync({
  userId,
  theme,
  accent,
}: {
  userId: string;
  theme: Theme;
  accent: Accent;
}) {
  useEffect(() => {
    let local: { theme: Theme; accent: Accent };
    try {
      if (window.localStorage.getItem(APPEARANCE_SYNCED_KEY) === userId) return;
      local = {
        theme: parseTheme(window.localStorage.getItem(THEME_KEY)),
        accent: parseAccent(window.localStorage.getItem(ACCENT_KEY)),
      };
    } catch {
      // Storage disabled: nothing to sync into. The head script already fell
      // back to the defaults.
      return;
    }

    const accountUntouched = theme === DEFAULT_THEME && accent === DEFAULT_ACCENT;
    const localCustom = local.theme !== DEFAULT_THEME || local.accent !== DEFAULT_ACCENT;

    if (accountUntouched && localCustom) {
      // Mark synced only once the account holds it, so a failed save is
      // retried on the next page load instead of being forgotten.
      saveAppearance(local)
        .then(({ error }) => {
          if (!error) writeStored(APPEARANCE_SYNCED_KEY, userId);
        })
        .catch(() => {});
      return;
    }

    try {
      writeStored(THEME_KEY, theme);
      writeStored(ACCENT_KEY, accent);
      writeStored(APPEARANCE_SYNCED_KEY, userId);
    } catch {
      return;
    }
    applyThemeToRoot(document.documentElement, theme, accent);
  }, [userId, theme, accent]);

  return null;
}
