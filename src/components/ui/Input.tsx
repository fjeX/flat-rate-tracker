import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Tabular numerals in JetBrains Mono — RO numbers, VINs, hours. */
  mono?: boolean;
};

/** Text input on the design system's `.input` well. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono, className, ...rest },
  ref,
) {
  const cls = ["input", mono && "mono", className].filter(Boolean).join(" ");
  return <input ref={ref} className={cls} {...rest} />;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multiline sibling of Input — same well, resizes vertically only. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...rest },
  ref,
) {
  const cls = ["input", className].filter(Boolean).join(" ");
  return <textarea ref={ref} className={cls} style={{ resize: "vertical" }} {...rest} />;
});
