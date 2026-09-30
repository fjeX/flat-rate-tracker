"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { isCurrent, type NavItem } from "./nav-items";

/**
 * Thumb-reachable bottom bar for phones (final.html .bottomnav). The current
 * page is an accent mark on the trim plate. Hidden from 1024px up, where the
 * rail takes over.
 */
export function BottomNav({ items, timerRunning = false }: { items: NavItem[]; timerRunning?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((item) => {
        const current = isCurrent(item, pathname);
        return (
          <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>
            <span className="bn-icon">
              <Icon name={item.icon} />
              {item.icon === "timer" && timerRunning && (
                <span className="run-dot" role="img" aria-label="Timer running" />
              )}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
