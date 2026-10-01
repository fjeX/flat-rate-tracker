// Two pictograms the dashboard needs that the shell's icon set doesn't carry.
// Paths lifted from final.html's symbol sheet (solid, one weight, 24 grid).
// Local because src/components/layout/icons.tsx is the shell's file.
const PATHS = {
  plus: <path d="M10.75 4h2.5v6.75H20v2.5h-6.75V20h-2.5v-6.75H4v-2.5h6.75z" />,
  chev: <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />,
} as const;

/** Decorative pictogram: always paired with a visible label. */
export function DashIcon({ name, className }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      className={`ic ic-sm${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
