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
    <nav className="sticky top-[57px] z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto max-w-5xl overflow-x-auto no-scrollbar">
        <ul className="flex min-w-max gap-1 px-2">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            const showDot = tab.href === "/timer" && timerRunning;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "text-orange-400"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                  {showDot && (
                    <span
                      className="relative inline-flex h-2 w-2"
                      aria-label="Timer running"
                    >
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
                    </span>
                  )}
                  {active && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-orange-500" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
