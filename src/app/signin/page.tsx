import Link from "next/link";
import { signIn } from "@/app/actions/auth";
import { GoogleButton } from "@/components/auth/google-button";
import { AuthOr, AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/ui/Field";
import { StatusField } from "@/components/ui/StatusField";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;
  const safeError = error && error.length <= 150 && !/https?:\/\/|<|>/.test(error)
    ? error
    : error
    ? "Sign in failed. Please try again."
    : null;

  return (
    <AuthShell title="Sign in">
      {/* Arriving from a completed password reset. Without this the redirect
          reads as "it dumped me back at the login screen" rather than "that
          worked, now prove it". */}
      {reset && !safeError && (
        <StatusField tag="Saved" role="status" inset>
          <p>Password updated. Sign in with your new password.</p>
        </StatusField>
      )}

      {safeError && (
        <StatusField tag="Fix" role="alert" inset>
          <p>{safeError}</p>
        </StatusField>
      )}

      <form action={signIn} className="auth-form">
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="input"
          />
        </Field>
        <button type="submit" className="btn btn-go btn-block">
          Sign in
        </button>
      </form>

      {/* Bot §8i: under the Sign in button, above the "or" divider. */}
      <p className="auth-aside is-tight">
        <Link href="/forgot-password" className="auth-link">
          Forgot your password?
        </Link>
      </p>

      <AuthOr />

      <GoogleButton />

      <p className="auth-aside">
        No account?{" "}
        <Link href="/signup" className="auth-link">
          Create one
        </Link>
      </p>
      <div className="auth-foot">
        <Link href="/guest" className="btn btn-quiet btn-block">
          Try as Guest
        </Link>
      </div>
    </AuthShell>
  );
}
