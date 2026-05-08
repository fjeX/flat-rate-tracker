"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  { href: "/log", label: "Log RO", match: (p: string) => p.startsWith("/log") },
  { href: "/history", label: "History", match: (p: string) => p.startsWith("/history") },
  { href: "/timer", label: "Timer", match: (p: string) => p.startsWith("/timer") },
  { href: "/pay-period", label: "Pay Period", match: (p: string) => p.startsWith("/pay-period") },
  { href: "/op-codes", label: "Op Codes", match: (p: string) => p.startsWith("/op-codes") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export function Nav({ timerRunning = false }: { timerRunning?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="app-tabs">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const showDot = tab.href === "/timer" && timerRunning;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`app-tab${active ? " active" : ""}`}
          >
            {tab.label}
            {showDot && <span className="running-dot" aria-label="Timer running" />}
          </Link>
        );
      })}
    </nav>
  );
}
