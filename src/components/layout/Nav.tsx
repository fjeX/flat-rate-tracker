"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardPlus, Timer, History, Hash } from "lucide-react";
import { BottomNav, type BottomTab } from "./BottomNav";

const TABS = [
  { href: "/dashboard", label: "Dashboard", match: (p: string) => p === "/dashboard" },
  { href: "/log", label: "Log RO", match: (p: string) => p.startsWith("/log") },
  { href: "/history", label: "History", match: (p: string) => p.startsWith("/history") },
  { href: "/timer", label: "Timer", match: (p: string) => p.startsWith("/timer") },
  { href: "/pay-period", label: "Pay Period", match: (p: string) => p.startsWith("/pay-period") },
  { href: "/op-codes", label: "Op Codes", match: (p: string) => p.startsWith("/op-codes") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export function Nav({ timerRunning = false }: { timerRunning?: boolean }) {
  const pathname = usePathname();

  // Mobile thumb bar — the 5 most-used destinations. Pay Period + Settings
  // live in the header on mobile (and remain in the top tabs on desktop).
  const bottomTabs: BottomTab[] = [
    { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={22} />, match: (p) => p === "/dashboard" },
    { href: "/log", label: "Log RO", icon: <ClipboardPlus size={22} />, match: (p) => p.startsWith("/log") },
    { href: "/timer", label: "Timer", icon: <Timer size={22} />, match: (p) => p.startsWith("/timer"), showDot: timerRunning },
    { href: "/history", label: "History", icon: <History size={22} />, match: (p) => p.startsWith("/history") },
    { href: "/op-codes", label: "Op Codes", icon: <Hash size={22} />, match: (p) => p.startsWith("/op-codes") },
  ];

  return (
    <>
      <nav className="app-tabs" aria-label="Primary">
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
      <BottomNav tabs={bottomTabs} />
    </>
  );
}
