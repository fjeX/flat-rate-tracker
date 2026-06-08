import Link from "next/link";
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
