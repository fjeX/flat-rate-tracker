// Theme and accent: which palette block in globals.css applies.
//
// The choice lives on <html> as data-theme / data-accent. The <head> script
// below is the only thing that reads localStorage for it, and it runs before
// first paint so there is no flash of the default look. The signed-in value
// lives on user_settings; AppearanceSync copies it into localStorage, so the
// head script never has to wait on the network.

export const THEMES = ["dark", "light", "dark-graphite", "dark-pitch"] as const;
export const ACCENTS = ["blue", "orange", "teal", "red", "ink"] as const;
export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];

export const DEFAULT_THEME: Theme = "dark";
export const DEFAULT_ACCENT: Accent = "blue";

export const THEME_KEY = "theme";
export const ACCENT_KEY = "accent";

export function parseTheme(raw: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(raw ?? "") ? (raw as Theme) : DEFAULT_THEME;
}

export function parseAccent(raw: string | null | undefined): Accent {
  return (ACCENTS as readonly string[]).includes(raw ?? "") ? (raw as Accent) : DEFAULT_ACCENT;
}

/** Put a theme on <html> after hydration (a settings toggle). Mirrors the head script. */
export function applyThemeToRoot(root: HTMLElement, theme: Theme, accent?: Accent): void {
  root.dataset.theme = theme;
  if (accent) root.dataset.accent = accent;
}

// Plain ES5 on purpose: it is inlined into <head> and runs before any bundle.
// Unknown or missing values fall back to the defaults, same as the parsers.
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var a=localStorage.getItem(${JSON.stringify(ACCENT_KEY)});if(${JSON.stringify(
  THEMES,
)}.indexOf(t)<0)t=${JSON.stringify(DEFAULT_THEME)};if(${JSON.stringify(
  ACCENTS,
)}.indexOf(a)<0)a=${JSON.stringify(
  DEFAULT_ACCENT,
)};d.setAttribute('data-theme',t);d.setAttribute('data-accent',a);}catch(e){}})();`;
