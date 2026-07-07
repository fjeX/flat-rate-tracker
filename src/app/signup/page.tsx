import Link from "next/link";
import { signUp } from "@/app/actions/auth";
import { GoogleButton } from "@/components/auth/google-button";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="mb-8">
        <Link href="/" className="no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/frt-logo.png" alt="Flat Rate Tracker" style={{ height: 100, width: "auto" }} />
        </Link>
      </div>
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold mb-4">Create account</h1>

        {error && (
          <div role="alert" className="mb-4 rounded-[var(--radius-sm)] border border-[var(--bad)] bg-[var(--bad-bg)] px-3 py-2 text-sm text-[var(--bad)]">
            {error}
          </div>
        )}

        <form action={signUp} className="space-y-3">
          <label className="block">
            <span className="text-sm text-[var(--fg-2)]">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="input mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--fg-2)]">Password</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input mt-1"
            />
            <span className="mt-1 block text-xs text-[var(--fg-3)]">
              At least 8 characters.
            </span>
          </label>
          <button type="submit" className="btn btn-primary btn-block">
            Create account
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--line)]" />
          <span className="text-xs text-[var(--fg-3)]">or</span>
          <div className="h-px flex-1 bg-[var(--line)]" />
        </div>

        <GoogleButton />

        <p className="mt-4 text-sm text-[var(--fg-2)]">
          Already have an account?{" "}
          <Link href="/signin" className="text-[var(--brand)] hover:opacity-80">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
