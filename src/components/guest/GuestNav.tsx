"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/guest", label: "Dashboard", match: (p: string) => p === "/guest" },
  { href: "/guest/log", label: "Log RO", match: (p: string) => p.startsWith("/guest/log") },
  { href: "/guest/history", label: "History", match: (p: string) => p.startsWith("/guest/history") },
  { href: "/guest/op-codes", label: "Op Codes", match: (p: string) => p.startsWith("/guest/op-codes") },
  { href: "/guest/timer", label: "Timer", match: (p: string) => p.startsWith("/guest/timer") },
];

export function GuestNav() {
  const pathname = usePathname();
  return (
    <nav className="app-tabs">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`app-tab${active ? " active" : ""}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
