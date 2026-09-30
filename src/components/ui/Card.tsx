import type { ElementType, HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** No internal padding — for cards whose children manage their own (lists, tables). */
  flush?: boolean;
  /** Larger internal padding for roomy content. */
  paddedLg?: boolean;
  /** Accent-tinted surface for callouts (text stays ink). */
  tinted?: boolean;
  /**
   * Inset well on top of a card — a recessed `--plate` fill instead of a
   * panel. Use for grouped rows inside an already-drawn card.
   */
  inset?: boolean;
  /** Zone name: renders a label-style tab hanging from the panel's top rule. */
  name?: ReactNode;
  /** Heading element for the zone name. Defaults to h2. */
  nameAs?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span";
};

/**
 * The zone panel: `--panel` fill, heavy top rule, hairline on the other
 * sides, no shadow. `name` adds the zone-name tab. `inset` flips it to a
 * recessed well for card-in-card grouping (no zone rule, no tab).
 */
export function Card({ flush, paddedLg, tinted, inset, name, nameAs, className, children, ...rest }: CardProps) {
  const cls = [
    inset ? "card-inset" : "card",
    !flush && !inset && (paddedLg ? "padded-lg" : "padded"),
    flush && "flush",
    tinted && "brand-tinted",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const NameTag: ElementType = nameAs ?? "h2";
  return (
    <div className={cls} {...rest}>
      {name != null && !inset && <NameTag className="zone-name">{name}</NameTag>}
      {children}
    </div>
  );
}

// ---- Headline panel ---------------------------------------------------------
// "The number that matters". Look is driven by the --head-* tokens (Accent
// treatment by default), so these components carry structure only.

/** The headline panel shell (`.head`). */
export function Head({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["head", className].filter(Boolean).join(" ")} {...rest} />;
}

/** Two-column row of cells inside a Head (`.head-cells`). */
export function HeadCells({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["head-cells", className].filter(Boolean).join(" ")} {...rest} />;
}

/**
 * One cell: label, figure, optional unit and sub-line. The figure is set in
 * `--font-num`, so pass figures only (hours, money, percent). `secondary`
 * drops it to the smaller second-figure size.
 */
export function HeadCell({
  label,
  value,
  unit,
  sub,
  secondary,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  secondary?: boolean;
}) {
  return (
    <div className={["head-cell", className].filter(Boolean).join(" ")} {...rest}>
      <div className="head-k">{label}</div>
      <div className={`head-v num${secondary ? " is-2" : ""}`}>
        {value}
        {unit != null && <span className="unit">{unit}</span>}
      </div>
      {sub != null && <div className="head-s">{sub}</div>}
    </div>
  );
}

/** Footnote strip under the cells (`.head-note`). */
export function HeadNote({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["head-note", className].filter(Boolean).join(" ")} {...rest} />;
}

/** The headline panel as a single row: running total, period total (`.head-row`). */
export function HeadRow({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["head-row", className].filter(Boolean).join(" ")} {...rest} />;
}
