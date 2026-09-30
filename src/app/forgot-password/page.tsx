import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/ui/Field";
import { StatusField } from "@/components/ui/StatusField";

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

  if (sent) {
    return (
      <AuthShell title="Reset your password">
        {/* Deliberately does not confirm the address exists — see the
            enumeration note on requestPasswordReset(). */}
        <StatusField tag="Note" inset>
          <p>
            If that address has an account, a reset link is on its way. The
            link is good for one use and expires shortly.
          </p>
          <p>
            Nothing arrived after a few minutes? Check your spam folder, then
            try again.
          </p>
        </StatusField>
        <div className="auth-stack">
          <Link href="/signin" className="btn btn-quiet btn-block">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password">
      <p className="auth-lede">Enter your email and we&apos;ll send you a link to set a new one.</p>

      {safeError && (
        <StatusField tag="Fix" role="alert" inset>
          <p>{safeError}</p>
        </StatusField>
      )}

      <form action={requestPasswordReset} className="auth-form">
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </Field>
        <button type="submit" className="btn btn-go btn-block">
          Send reset link
        </button>
      </form>

      <p className="auth-aside">
        Remembered it?{" "}
        <Link href="/signin" className="auth-link">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
