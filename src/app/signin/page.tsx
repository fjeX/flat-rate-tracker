import Link from "next/link";
import { signIn } from "@/app/actions/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4">
      <div className="mb-8">
        <Link href="/" className="no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/frt-logo.png" alt="Flat Rate Tracker" style={{ height: 100, width: "auto" }} />
        </Link>
      </div>
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h1 className="text-xl font-semibold mb-4">Sign in</h1>

        {error && (
          <div className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <form action={signIn} className="space-y-3">
          <label className="block">
            <span className="text-sm text-zinc-400">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm text-zinc-400">Password</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-orange-600 hover:bg-orange-500 px-3 py-2 text-sm font-medium transition-colors"
          >
            Sign in
          </button>
        </form>

        <p className="mt-4 text-sm text-zinc-400">
          No account?{" "}
          <Link href="/signup" className="text-orange-400 hover:text-orange-300">
            Create one
          </Link>
        </p>
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <Link
            href="/guest"
            className="block w-full rounded-md border border-zinc-700 px-3 py-2 text-center text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            Try as Guest
          </Link>
        </div>
      </div>
    </main>
  );
}
