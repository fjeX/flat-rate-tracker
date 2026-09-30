import type { ReactNode } from "react";

/**
 * One setting (phase 5 sketch): the name and the sentence that earns it on
 * the left, the control on the right (below it on a phone), a hairline
 * between rows. Every settings card and the account page are made of these,
 * so they read as one list instead of eleven boxes.
 *
 * `wide` puts the control under the text at every width — for a control that
 * needs the row (pay rates, templates, the danger zone).
 */
export function SettingRow({
  title,
  titleAs = "h3",
  id,
  description,
  fine,
  wide,
  tone,
  children,
}: {
  title: ReactNode;
  /** Heading level. Tests and the bot read some of these as h2. */
  titleAs?: "h2" | "h3";
  id?: string;
  description?: ReactNode;
  /** The smaller line under the description. */
  fine?: ReactNode;
  wide?: boolean;
  /** bad = the danger zone: red title, red top rule. */
  tone?: "bad";
  children?: ReactNode;
}) {
  const Title = titleAs;
  return (
    <div className={`stg-row${wide ? " is-wide" : ""}${tone === "bad" ? " is-bad" : ""}`} id={id}>
      <div className="stg-txt">
        <Title className="stg-title">{title}</Title>
        {description && <p className="stg-desc">{description}</p>}
        {fine && <p className="stg-fine">{fine}</p>}
      </div>
      {children != null && <div className="stg-ctl">{children}</div>}
    </div>
  );
}
