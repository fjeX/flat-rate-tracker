import type { ReactNode } from "react";

// Pictograms lifted from final.html's symbol sheet: solid, one weight, 24 grid.
// Inline per use instead of a shared <symbol> sheet so each component stays
// self-contained (no hidden dependency on a sprite somewhere else in the DOM).
const PATHS = {
  dash: <path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" />,
  log: <path d="M8 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zm4 2.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM7.5 11v2.25h9V11zm0 4.5v2.25h9V15.5z" />,
  timer: (
    <>
      <path d="M9 1h6v2.5H9z" />
      <path d="M12 5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm-1.25 3.5h2.5v6.25h-2.5z" />
    </>
  ),
  history: <path d="M3 4h3v3H3zM8 4h13v3H8zM3 10.5h3v3H3zM8 10.5h13v3H8zM3 17h3v3H3zM8 17h13v3H8z" />,
  codes: (
    <>
      <path fillRule="nonzero" d="M8 3h2.5v18H8zM13.5 3H16v18h-2.5z" />
      <path fillRule="nonzero" d="M3 8h18v2.5H3zM3 13.5h18V16H3z" />
    </>
  ),
  period: (
    <>
      <path d="M7 2h2.5v2H7zM14.5 2H17v2h-2.5z" />
      <path d="M4 4h16a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1.5 5.5v9h13v-9zM8 12h3.5v3.5H8z" />
    </>
  ),
  insights: <path d="M3 13h4.5v8H3zM9.75 8h4.5v13h-4.5zM16.5 3H21v18h-4.5z" />,
  schedule: (
    <>
      <path d="M7 2h2.5v2H7zM14.5 2H17v2h-2.5z" />
      <path d="M4 4h16a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1.5 5.5v9h13v-9zM7.5 11h2.5v2.5H7.5zm3.25 0h2.5v2.5h-2.5zM14 11h2.5v2.5H14zm-6.5 3.5h2.5V17H7.5zm3.25 0h2.5V17h-2.5z" />
    </>
  ),
  settings: <path d="M3 5h9.5v2.5H3zM16.5 5H21v2.5h-4.5zM13 3h3v6.5h-3zM3 10.75h3v2.5H3zM10 10.75h11v2.5H10zM6.5 8.75h3v6.5h-3zM3 16.5h11.5V19H3zM18.5 16.5H21V19h-2.5zM15 14.5h3V21h-3z" />,
  account: <path d="M12 2.5a3.75 3.75 0 1 1 0 7.5 3.75 3.75 0 0 1 0-7.5zM5 21.5v-5a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v5z" />,
  signout: (
    <>
      <path d="M3 3h10v2.5H5.5v13H13V21H3z" />
      <path d="M9 10.75h7V7l6 5-6 5v-3.75H9z" />
    </>
  ),
  x: <path d="M6.3 4.5L12 10.2l5.7-5.7 1.8 1.8L13.8 12l5.7 5.7-1.8 1.8L12 13.8l-5.7 5.7-1.8-1.8L10.2 12 4.5 6.3z" />,
  menu: <path d="M3 5h18v2.5H3zM3 10.75h18v2.5H3zM3 16.5h18V19H3z" />,
  report: <path d="M3 3h18v14H9.5L5 21v-4H3zM10.75 5.5v6h2.5v-6zm0 7.25V15h2.5v-2.25z" />,
  here: <circle cx="12" cy="12" r="10" />,
  theme: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.5v15a7.5 7.5 0 0 1 0-15z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** Decorative by default: every caller pairs it with a visible label or aria-label. */
export function Icon({ name, small = false, className }: { name: IconName; small?: boolean; className?: string }) {
  return (
    <svg
      className={`ic${small ? " ic-sm" : ""}${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The tower mark from final.html. Colours come from CSS (.m-block / .m-bar). */
export function LogoMark() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect className="m-block" x="2" y="3" width="6" height="6" />
      <rect className="m-bar" x="10" y="3" width="16" height="6" />
      <rect className="m-block" x="2" y="11" width="6" height="6" />
      <rect className="m-bar" x="10" y="11" width="11" height="6" />
      <rect className="m-block" x="2" y="19" width="6" height="6" />
      <rect className="m-bar" x="10" y="19" width="14" height="6" />
    </svg>
  );
}

export function LogoWord() {
  return (
    <span className="logo-word">
      <b>FLAT RATE</b>
      <span>TRACKER</span>
    </span>
  );
}
