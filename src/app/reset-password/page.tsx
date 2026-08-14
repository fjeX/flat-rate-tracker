"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Step 2 of password recovery: the page the emailed link lands on.
 *
 * WHY THIS DOES NOT ACCEPT AN ORDINARY SESSION
 * The obvious implementation — "if there's a session, show the form" — would
 * quietly undo the current-password requirement on /account. Anyone sitting at
 * an unlocked session could walk to this URL and set a new password without
 * knowing the old one, which is exactly the takeover path that fix closed.
 *
 * So the form is gated on having exchanged a recovery code ON THIS PAGE LOAD.
 * No code, or a code that fails to exchange, means no form — even for a fully
 * signed-in user. The emailed link is the proof of identity here, standing in
 * for the current password, and nothing else is accepted in its place.
 *
 * This is a gate on what the APP offers, not a hard boundary: anyone holding
 * the raw access token can call GoTrue's PUT /user directly and skip every
 * screen in this repo. The real boundary is GoTrue's
 * SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION, which cannot be turned on
 * until SMTP works because it mails a nonce. Enable it once Resend is live.
 */

type Phase = "verifying" | "ready" | "invalid" | "done";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="mb-8">
        <Link href="/" className="no-underline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/frt-logo.png" alt="Flat Rate Tracker" style={{ height: 100, width: "auto" }} />
        </Link>
      </div>
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold mb-4">Set a new password</h1>
        {children}
      </div>
    </main>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read straight off the URL during render. Deriving the opening state here
  // rather than in an effect keeps the "no link, no form" decision a pure
  // function of the URL — there is no first paint where the form exists.
  const code = searchParams.get("code");
  // GoTrue reports a dead link by redirecting with these rather than a code.
  const linkError =
    searchParams.get("error_description") ?? searchParams.get("error");

  const [phase, setPhase] = useState<Phase>(() =>
    linkError || !code ? "invalid" : "verifying",
  );
  const [reason, setReason] = useState(() =>
    linkError
      ? "That link has expired or has already been used."
      : !code
      ? "This page needs a reset link to work."
      : "",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!code || linkError) return; // phase is already "invalid"

    let cancelled = false;
    const supabase = createClient();
    supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (cancelled) return;
      if (exchangeError) {
        setPhase("invalid");
        setReason("That link has expired or has already been used.");
        return;
      }
      // Drop the one-time code out of the address bar so it isn't left in
      // history, or leaked by a Referer header on the next navigation.
      window.history.replaceState({}, "", "/reset-password");
      setPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [code, linkError]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPhase("done");
    // The recovery session is a real session, so they are already signed in.
    router.refresh();
  }

  return (
    <Shell>
      {phase === "verifying" && (
        <p className="text-sm text-[var(--fg-2)]">Checking your link…</p>
      )}

      {phase === "invalid" && (
        <>
          <div role="alert" className="mb-4 rounded-[var(--radius-sm)] border border-[var(--bad)] bg-[var(--bad-bg)] px-3 py-2 text-sm text-[var(--bad)]">
            {reason}
          </div>
          <p className="mb-4 text-sm text-[var(--fg-2)]">
            Reset links are single-use. Request a fresh one and it&apos;ll work.
          </p>
          <Link href="/forgot-password" className="btn btn-primary btn-block">
            Request a new link
          </Link>
          <div className="mt-3">
            <Link href="/signin" className="btn btn-ghost btn-block">
              Back to sign in
            </Link>
          </div>
        </>
      )}

      {phase === "ready" && (
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div role="alert" className="rounded-[var(--radius-sm)] border border-[var(--bad)] bg-[var(--bad-bg)] px-3 py-2 text-sm text-[var(--bad)]">
              {error}
            </div>
          )}
          <label className="block">
            <span className="text-sm text-[var(--fg-2)]">New password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--fg-2)]">Confirm new password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              placeholder="Repeat new password"
              className="input mt-1"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
            {pending ? "Saving…" : "Set new password"}
          </button>
        </form>
      )}

      {phase === "done" && (
        <>
          <p className="mb-4 text-sm text-[var(--good)]">
            Password updated. You&apos;re signed in.
          </p>
          <Link href="/dashboard" className="btn btn-primary btn-block">
            Go to dashboard
          </Link>
        </>
      )}
    </Shell>
  );
}

// useSearchParams() needs a Suspense boundary or the whole route opts out of
// static rendering and `next build` complains.
export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p className="text-sm text-[var(--fg-2)]">Checking your link…</p>
        </Shell>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
