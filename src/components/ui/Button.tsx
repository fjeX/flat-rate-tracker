import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * Look. New names: `go` (the one primary action), `line` (outlined, the
   * default), `quiet` (hairline, secondary). Old names still work and map onto
   * them: `primary` = go, `ghost` = quiet. `good` is go in the state colour
   * (positive action); `danger` is line in the warm red.
   */
  variant?: "default" | "go" | "line" | "quiet" | "primary" | "ghost" | "danger" | "good";
  size?: "sm" | "lg";
  block?: boolean;
  /** Confirmation state: fills with the good colour. */
  saved?: boolean;
  /** Work in flight: sets aria-busy and the busy look. Does not disable. */
  busy?: boolean;
};

/**
 * The one button. Wraps the `.btn` classes (styles/ui-controls.css) so every
 * button gets the same edge, a 44px minimum touch target, and its own focus
 * ring. No hex, no ad-hoc classes: if a button needs to look different,
 * that's a token or variant conversation, not a className override.
 */
export function Button({
  variant = "default",
  size,
  block,
  saved,
  busy,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = [
    "btn",
    variant !== "default" && `btn-${variant}`,
    size && `btn-${size}`,
    block && "btn-block",
    saved && "is-saved",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={cls} aria-busy={busy || undefined} {...rest} />;
}
