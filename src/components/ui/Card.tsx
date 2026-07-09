import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** No internal padding — for cards whose children manage their own (lists, tables). */
  flush?: boolean;
  /** Larger internal padding for roomy content. */
  paddedLg?: boolean;
  /** Brand-tinted surface for callouts. */
  tinted?: boolean;
  /**
   * Inset well on top of a card — darker fill instead of elevation.
   * Use for grouped rows inside an already-raised card.
   */
  inset?: boolean;
};

/**
 * The raised surface. Elevation comes from --shadow-card, not a border —
 * that's the Calm Workspace rule. `inset` flips it to a sunken well for
 * card-in-card grouping.
 */
export function Card({ flush, paddedLg, tinted, inset, className, ...rest }: CardProps) {
  const cls = [
    inset ? "card-inset" : "card",
    !flush && !inset && (paddedLg ? "padded-lg" : "padded"),
    flush && "flush",
    tinted && "brand-tinted",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <div className={cls} {...rest} />;
}
