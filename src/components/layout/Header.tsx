import Link from "next/link";
import { Wrench } from "lucide-react";
import { signOut } from "@/app/actions/auth";

export function Header({ userEmail }: { userEmail?: string | null }) {
  return (
    <header className="app-header">
      <Link href="/" className="app-brand">
        <span className="app-brand-mark">
          <Wrench size={18} color="white" strokeWidth={2} />
        </span>
        <div>
          <div className="app-brand-name">Flat Rate Tracker</div>
          {userEmail && (
            <span className="app-brand-sub">{userEmail.split("@")[0]}</span>
          )}
        </div>
      </Link>

      {userEmail && (
        <form action={signOut}>
          <button type="submit" className="btn btn-ghost btn-sm" style={{ color: "var(--fg-3)" }}>
            Sign out
          </button>
        </form>
      )}
    </header>
  );
}
