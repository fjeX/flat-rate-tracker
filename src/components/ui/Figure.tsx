import type { ReactNode } from "react";

/**
 * Wraps the decimal point/comma between two digits in `<span class="pt">` so
 * it pulls in by --pt-pull (mock final.html:362). Text content is unchanged
 * ("8.5" stays "8.5" for screen readers and copy/paste): the span is inline
 * and adds no whitespace.
 */
export function withPt(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\d)([.,])(?=\d)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const sepAt = m.index + 1;
    out.push(text.slice(last, sepAt));
    out.push(
      <span key={sepAt} className="pt">
        {m[2]}
      </span>,
    );
    last = sepAt + 1;
  }
  out.push(text.slice(last));
  return out;
}

/** A figure: Azeret Mono, tabular, tight tracking, decimal pulled in. */
export function Figure({ value, className }: { value: string; className?: string }) {
  return <span className={`num${className ? ` ${className}` : ""}`}>{withPt(value)}</span>;
}
