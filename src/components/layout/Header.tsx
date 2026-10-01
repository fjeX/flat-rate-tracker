"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DirectoryButton } from "./DirectoryDialog";
import { Icon, LogoMark, LogoWord } from "./icons";
import { APP_ITEMS, APP_SUB } from "./nav-items";

/**
 * Phone top bar (final.html .topbar). From 1024px up CSS hides it and the rail
 * carries the logo instead. Signed out (userEmail null/undefined) it is the
 * logo alone, unless the shell passes `actions` (guest mode puts its own
 * directory button there).
 */
export function Header({
  userEmail,
  timerRunning = false,
  actions,
}: {
  userEmail?: string | null;
  timerRunning?: boolean;
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const onPayPeriod = pathname.startsWith("/pay-period");
  return (
    <header className="topbar">
      <Link
        href={userEmail ? "/dashboard" : "/"}
        className="logo"
        aria-label={userEmail ? "Flat Rate Tracker, go to Dashboard" : "Flat Rate Tracker"}
      >
        <LogoMark />
        <LogoWord />
      </Link>
      {userEmail ? (
        <div className="topbar-actions">
          <Link
            href="/pay-period"
            className="iconbtn"
            aria-label="Pay Period"
            aria-current={onPayPeriod ? "page" : undefined}
          >
            <Icon name="period" />
          </Link>
          <DirectoryButton items={APP_ITEMS} sub={APP_SUB} timerRunning={timerRunning} />
        </div>
      ) : (
        actions && <div className="topbar-actions">{actions}</div>
      )}
    </header>
  );
}
