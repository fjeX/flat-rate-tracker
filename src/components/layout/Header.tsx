import Link from "next/link";
import { CalendarRange, Settings } from "lucide-react";
import { signOut } from "@/app/actions/auth";

export function Header({ userEmail }: { userEmail?: string | null }) {
  return (
    <header className="app-header">
      <Link href="/" className="app-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/frt-logo.png" alt="Flat Rate Tracker" style={{ height: 56, width: "auto" }} />
      </Link>
      {userEmail && (
        <div className="app-header-util">
          {/* Mobile only — these two live in the top tabs on desktop, but drop
              off the 5-item thumb bar, so surface them in the header on phones. */}
          <Link href="/pay-period" className="btn btn-ghost btn-sm header-mobile-only" aria-label="Pay Period" style={{ color: "var(--fg-3)" }}>
            <CalendarRange size={18} />
          </Link>
          <Link href="/settings" className="btn btn-ghost btn-sm header-mobile-only" aria-label="Settings" style={{ color: "var(--fg-3)" }}>
            <Settings size={18} />
          </Link>
          <Link href="/account" className="btn btn-ghost btn-sm" style={{ color: "var(--fg-3)" }}>
            Account
          </Link>
          <form action={signOut}>
            <button type="submit" className="btn btn-ghost btn-sm" style={{ color: "var(--fg-3)" }}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </header>
  );
}
