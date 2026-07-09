import type { ReactNode } from "react";

type FieldProps = {
  label: string;
  /** Ties label to control — pass the control's id. */
  htmlFor?: string;
  hint?: string;
  error?: string;
  /** Visually hide the label but keep it for screen readers. */
  labelHidden?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Label + control + hint/error, wired consistently. The error line replaces
 * the hint (never both) and tints the control via .field-error, so forms
 * can't drift into misaligned label/message layouts again.
 */
export function Field({ label, htmlFor, hint, error, labelHidden, children, className }: FieldProps) {
  const cls = ["field", error && "field-error", className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <label htmlFor={htmlFor} className={labelHidden ? "sr-only" : "field-label"}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field-msg field-msg-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-msg">{hint}</span>
      ) : null}
    </div>
  );
}
