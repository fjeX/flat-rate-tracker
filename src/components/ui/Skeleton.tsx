/**
 * Skeleton loaders — shape-accurate placeholders for the server-fetched
 * views (dashboard, history, pay period). Boring on purpose: no glow, no
 * brand color, just an opacity pulse on the --plate fill. Neutralized to
 * a static block under prefers-reduced-motion (see globals.css guard).
 */

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`skel${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
    />
  );
}
