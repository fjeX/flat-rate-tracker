"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardPlus, Timer, History, Hash } from "lucide-react";
import { BottomNav, type BottomTab } from "@/components/layout/BottomNav";
import { useGuestStore } from "@/lib/guest/context";

const TABS = [
  { href: "/guest", label: "Dashboard", match: (p: string) => p === "/guest" },
  { href: "/guest/log", label: "Log RO", match: (p: string) => p.startsWith("/guest/log") },
  { href: "/guest/history", label: "History", match: (p: string) => p.startsWith("/guest/history") },
  { href: "/guest/op-codes", label: "Op Codes", match: (p: string) => p.startsWith("/guest/op-codes") },
  { href: "/guest/timer", label: "Timer", match: (p: string) => p.startsWith("/guest/timer") },
];

export function GuestNav() {
  const pathname = usePathname();
  const { timerState } = useGuestStore();
  const timerRunning = timerState.startTime !== null;

  // Guest mode has no floating TimerPip (it depends on server-fetched app
  // context); mirroring the authed Nav's running-dot on the Timer tab is the
  // least-invasive way to surface "you have a timer going" while browsing
  // other guest pages.
  const bottomTabs: BottomTab[] = [
    { href: "/guest", label: "Dashboard", icon: <LayoutDashboard size={22} />, match: (p) => p === "/guest" },
    { href: "/guest/log", label: "Log RO", icon: <ClipboardPlus size={22} />, match: (p) => p.startsWith("/guest/log") },
    { href: "/guest/timer", label: "Timer", icon: <Timer size={22} />, match: (p) => p.startsWith("/guest/timer"), showDot: timerRunning },
    { href: "/guest/history", label: "History", icon: <History size={22} />, match: (p) => p.startsWith("/guest/history") },
    { href: "/guest/op-codes", label: "Op Codes", icon: <Hash size={22} />, match: (p) => p.startsWith("/guest/op-codes") },
  ];

  return (
    <>
      <nav className="app-tabs" aria-label="Primary">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const showDot = tab.href === "/guest/timer" && timerRunning;
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
