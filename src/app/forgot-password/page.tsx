import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/auth";

// Step 1 of password recovery: ask for the address, hand off to GoTrue.
// Step 2 lives at /reset-password, which the emailed link lands on.
//
// Both routes must be reachable signed-out — see the RECOVERY_ROUTES note in
// src/lib/supabase/proxy.ts for why /reset-password additionally must NOT
// bounce a signed-in user the way /signin does.
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;
  const safeError = error && error.length <= 150 && !/https?:\/\/|<|>/.test(error)
    ? error
    : error
    ? "Something went wrong. Please try again."
    : null;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="mb-8">
        <Link href="/" className="no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/frt-logo.png" alt="Flat Rate Tracker" style={{ height: 100, width: "auto" }} />
        </Link>
      </div>
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold mb-1">Reset your password</h1>

        {sent ? (
          <>
            {/* Deliberately does not confirm the address exists — see the
                enumeration note on requestPasswordReset(). */}
            <p className="mt-3 text-sm text-[var(--fg-2)]">
              If that address has an account, a reset link is on its way. The
              link is good for one use and expires shortly.
            </p>
            <p className="mt-3 text-sm text-[var(--fg-3)]">
              Nothing arrived after a few minutes? Check your spam folder, then
              try again.
            </p>
            <div className="mt-4">
              <Link href="/signin" className="btn btn-ghost btn-block">
                Back to sign in
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--fg-2)]">
              Enter your email and we&apos;ll send you a link to set a new one.
            </p>

            {safeError && (
              <div role="alert" className="mb-4 rounded-[var(--radius-sm)] border border-[var(--bad)] bg-[var(--bad-bg)] px-3 py-2 text-sm text-[var(--bad)]">
                {safeError}
              </div>
            )}

            <form action={requestPasswordReset} className="space-y-3">
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
              <button type="submit" className="btn btn-primary btn-block">
                Send reset link
              </button>
            </form>

            <p className="mt-4 text-sm text-[var(--fg-2)]">
              Remembered it?{" "}
              <Link href="/signin" className="text-[var(--brand)] hover:opacity-80">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
