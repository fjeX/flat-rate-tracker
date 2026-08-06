"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export type BottomTab = {
  href: string;
  label: string;
  icon: ReactNode;
  match: (p: string) => boolean;
  showDot?: boolean;
};

/**
 * Thumb-reachable bottom tab bar for mobile. Hidden on desktop via CSS
 * (.bottom-nav only displays under 900px, where .app-tabs is hidden).
 *
 * These links opt out of prefetching for the same reason as the desktop tabs
 * in Nav.tsx — the post-save re-prefetch storm strands the refresh carrying the
 * new numbers, leaving a stale dashboard. See bug c655c010.
 */
export function BottomNav({ tabs }: { tabs: BottomTab[] }) {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            className={`bottom-tab${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="bottom-tab-icon">
              {tab.icon}
              {tab.showDot && <span className="bottom-running-dot" aria-label="Timer running" />}
            </span>
            <span className="bottom-tab-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
