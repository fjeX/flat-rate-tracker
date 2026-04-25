import Link from "next/link";
import { Wrench } from "lucide-react";
import { signOut } from "@/app/actions/auth";

export function Header({ userEmail }: { userEmail?: string | null }) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-zinc-100 hover:text-orange-400 transition-colors"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-600">
            <Wrench className="h-5 w-5 text-white" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            Flat Rate Tracker
          </span>
        </Link>

        {userEmail && (
          <form action={signOut}>
            <button
              type="submit"
              className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
              title={`Signed in as ${userEmail}`}
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
