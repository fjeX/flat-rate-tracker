import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual weight. `danger` is destructive; `good` is a positive/"go" action. */
  variant?: "default" | "primary" | "ghost" | "danger" | "good";
  size?: "sm" | "lg";
  block?: boolean;
};

/**
 * The one button. Wraps the `.btn` classes from globals.css so every button
 * gets the same radius, touch target (≥44px on mobile), and focus ring.
 * No hex, no ad-hoc classes — if a button needs to look different, that's
 * a token or variant conversation, not a className override.
 */
export function Button({
  variant = "default",
  size,
  block,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const cls = [
    "btn",
    variant !== "default" && `btn-${variant}`,
    size && `btn-${size}`,
    block && "btn-block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={cls} {...rest} />;
}
