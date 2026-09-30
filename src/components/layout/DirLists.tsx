"use client";

// The two lists behind the desktop rail and the phone directory: every page,
// then the account items. One implementation so the two can never drift.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import { Icon } from "./icons";
import { isCurrent, type NavItem, type SubItem } from "./nav-items";

export function MainList({
  items,
  timerRunning = false,
  onNavigate,
}: {
  items: NavItem[];
  timerRunning?: boolean;
  /** Called when a link is followed (the directory dialog closes itself). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <ul className="dir-list">
      {items.map((item) => {
        const current = isCurrent(item, pathname);
        return (
          <li key={item.href}>
            <Link href={item.href} aria-current={current ? "page" : undefined} onClick={onNavigate}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.icon === "timer" && timerRunning && (
                <span className="run-dot" role="img" aria-label="Timer running" />
              )}
              <Icon name="here" className="here" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SubList({ items, onNavigate }: { items: SubItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  if (items.length === 0) return null;
  return (
    <ul className="dir-list dir-sub">
      {items.map((item) =>
        "signOut" in item ? (
          <li key={item.label}>
            <form action={signOut}>
              <button type="submit">
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            </form>
          </li>
        ) : (
          <li key={item.label}>
            <Link
              href={item.href}
              aria-current={isCurrent({ href: item.href }, pathname) ? "page" : undefined}
              onClick={onNavigate}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              <Icon name="here" className="here" />
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}
