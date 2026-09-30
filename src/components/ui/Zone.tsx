import Link from "next/link";
import { useId, type ElementType, type ReactNode } from "react";

/**
 * A zone (mock `.zone`): a bounded, named region of the WALL. Heavy rule on
 * top, the name hanging from it as a tab, an optional link or count on the
 * right. No fill and no side borders: the zone holds its own panels.
 *
 * Not `Card` on purpose. Card is a filled panel (66 legacy `.card` uses need
 * containment); Zone is the open region the mock draws. Both share the
 * `.zone-name` tab.
 *
 * Renders a `<section>` labelled by its name.
 */
export function Zone({
  name,
  nameAs,
  id,
  link,
  aside,
  className,
  children,
}: {
  name: ReactNode;
  /** Heading element for the name. Defaults to h2. */
  nameAs?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span";
  /** Id of the name heading (what the section's aria-labelledby points at). Generated when omitted; pass one only if the page needs a stable id. */
  id?: string;
  /** A "View all" style link on the right of the head, with a chevron. */
  link?: { href: string; label: string };
  /** Plain text on the right of the head, for a count that is not a link. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const auto = useId();
  const headId = id ?? `zone-${auto}`;
  const NameTag: ElementType = nameAs ?? "h2";
  return (
    <section className={`zone${className ? ` ${className}` : ""}`} aria-labelledby={headId}>
      <div className="zone-head">
        <NameTag className="zone-name" id={headId}>
          {name}
        </NameTag>
        {aside != null && <span className="zone-aside">{aside}</span>}
        {link && (
          <Link className="zone-link" href={link.href}>
            {link.label}
            <svg className="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />
            </svg>
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
