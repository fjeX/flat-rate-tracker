import type { HTMLAttributes } from "react";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "brand" | "good" | "warn" | "bad" | "info";
  /** JetBrains Mono — op codes and other machine identifiers. */
  mono?: boolean;
};

/**
 * Small tinted label. Replaces the dozen hand-rolled
 * `rounded bg-[var(--bg-3)] px-1.5 py-0.5 text-[10px] …` clusters the
 * Phase 0 audit found — tone is a prop, not a className recipe.
 */
export function Badge({ tone = "neutral", mono, className, ...rest }: BadgeProps) {
  const cls = ["badge", `badge-${tone}`, mono && "mono", className].filter(Boolean).join(" ");
  return <span className={cls} {...rest} />;
}
