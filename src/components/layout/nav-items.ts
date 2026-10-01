import type { IconName } from "./icons";

// Plain data on purpose (no functions, no JSX): the server-rendered Header
// hands these to client components, and only serializable props can cross.

export type NavItem = { href: string; label: string; icon: IconName; exact?: boolean };
export type SubItem = { label: string; icon: IconName } & ({ href: string } | { signOut: true });

/** Current-page test shared by the rail, the bottom bar and the directory. */
export function isCurrent(item: Pick<NavItem, "href" | "exact">, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

// final.html NAV: the directory lists every page, in this order.
export const APP_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dash", exact: true },
  { href: "/log", label: "Log RO", icon: "log" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/timer", label: "Timer", icon: "timer" },
  { href: "/pay-period", label: "Pay Period", icon: "period" },
  { href: "/insights", label: "Insights", icon: "insights" },
  { href: "/schedule", label: "Schedule", icon: "schedule" },
  { href: "/op-codes", label: "Op Codes", icon: "codes" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

// The thumb bar: five most-used pages, in the mock's order.
export const APP_BOTTOM: NavItem[] = ["/dashboard", "/log", "/timer", "/history", "/op-codes"].map(
  (href) => APP_ITEMS.find((i) => i.href === href)!,
);

export const APP_SUB: SubItem[] = [
  { label: "Account", icon: "account", href: "/account" },
  { label: "Sign out", icon: "signout", signOut: true },
];

// Guest mode only has these five pages.
export const GUEST_ITEMS: NavItem[] = [
  { href: "/guest", label: "Dashboard", icon: "dash", exact: true },
  { href: "/guest/log", label: "Log RO", icon: "log" },
  { href: "/guest/history", label: "History", icon: "history" },
  { href: "/guest/timer", label: "Timer", icon: "timer" },
  { href: "/guest/op-codes", label: "Op Codes", icon: "codes" },
];

export const GUEST_BOTTOM: NavItem[] = ["/guest", "/guest/log", "/guest/timer", "/guest/history", "/guest/op-codes"].map(
  (href) => GUEST_ITEMS.find((i) => i.href === href)!,
);
