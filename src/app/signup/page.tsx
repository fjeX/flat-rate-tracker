import Link from "next/link";
import { signUp } from "@/app/actions/auth";
import { GoogleButton } from "@/components/auth/google-button";
import { AuthOr, AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/ui/Field";
import { StatusField } from "@/components/ui/StatusField";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; check?: string }>;
}) {
  const { error, check } = await searchParams;

  // Email confirmation is on, so signUp returns no session. Without this
  // state the redirect would land on /dashboard, bounce to /signin, and read
  // as "signing up didn't work".
  if (check) {
    return (
      <AuthShell title="Check your email">
        <StatusField tag="Note" inset>
          <p>
            Your account is created. We sent a confirmation link — click it to
            finish setting up and sign in.
          </p>
          <p>Nothing after a few minutes? Check your spam folder.</p>
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
    <AuthShell title="Create account">
      {error && (
        <StatusField tag="Fix" role="alert" inset>
          <p>{error}</p>
        </StatusField>
      )}

      <form action={signUp} className="auth-form">
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required autoComplete="email" className="input" />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
          />
        </Field>
        <button type="submit" className="btn btn-go btn-block">
          Create account
        </button>
      </form>

      <AuthOr />

      <GoogleButton />

      <p className="auth-aside">
        Already have an account?{" "}
        <Link href="/signin" className="auth-link">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
