import type { HTMLAttributes } from "react";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  /** neutral = ink, good/bad = state colours, warn = NOTE-style ink-2, brand/info = accent text. */
  tone?: "neutral" | "brand" | "good" | "warn" | "bad" | "info";
  /**
   * Op codes and other machine identifiers. These are identifiers, not
   * figures, so this stays on --font-ui (bold, 0.02em tracking, case kept) —
   * it deliberately does NOT switch to the figure font. Mock: `.ops li b`.
   */
  mono?: boolean;
  /** Op-code chip: quiet hairline outline, sentence case, instead of the status-word tag. */
  chip?: boolean;
  /** Accent fill (--accent / --accent-ink). For a chip that is currently picked. */
  selected?: boolean;
};

/**
 * The tagged status word: an outlined label (NOTE / COST / FIX / SAVED) whose
 * outline and text share one colour. With `chip` it becomes the op-code chip.
 */
export function Badge({ tone = "neutral", mono, chip, selected, className, ...rest }: BadgeProps) {
  const cls = [
    "badge",
    !chip && `badge-${tone}`,
    chip && "badge-chip",
    mono && "mono",
    selected && "is-selected",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={cls} {...rest} />;
}
