"use client";

import { Suspense, useEffect, useRef, useState } from "react";
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

  // Starts as "verifying" in every case: the fragment is only readable on the
  // client, so the real answer cannot be known during render.
  const [phase, setPhase] = useState<Phase>("verifying");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  // The verify effect below reads the fragment, but its deps come from the
  // QUERY STRING, so a fragment that changes while this page stays mounted is
  // never re-parsed. Today no in-app route navigates to /reset-password — every
  // real arrival is a fresh document load — so this is dormant rather than
  // broken. It goes live the day someone adds a "forgot password" link inside
  // the authed app, which is exactly the kind of change nobody would connect to
  // this file. Bumping a counter re-runs the parse.
  // Once this page has reached a terminal answer, only a genuinely NEW recovery
  // answer may replace it. See the guard in the verify effect for why that is
  // load-bearing rather than defensive.
  const settledRef = useRef(false);
  const [hashTick, setHashTick] = useState(0);
  useEffect(() => {
    const onHashChange = () => {
      // Only for a fragment that actually carries a recovery answer. A bare "#"
      // or an in-page anchor must NOT re-run the parse: an empty fragment
      // settles "invalid", which would tear down an already-verified form under
      // someone who is mid-reset. `history.replaceState` (the scrub below) does
      // not fire hashchange, so the scrub cannot feed this back on itself.
      if (/(?:access_token|error_description|error)=/.test(window.location.hash)) {
        setHashTick((t) => t + 1);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // GoTrue answers in one of TWO shapes and this page has to accept both.
    //
    //   PKCE     -> ?code=...            (when the request carried a challenge,
    //                                     which it does when the app's own
    //                                     /forgot-password sent it)
    //   implicit -> #access_token=...&type=recovery
    //
    // Errors follow the same split: an expired link reports through the query
    // string under PKCE and through the FRAGMENT under implicit. Reading only
    // the query string made a dead link render as "this page needs a reset
    // link", which blames the user for a token that simply timed out.
    //
    // Read the fragment BEFORE constructing the client: supabase-js has
    // detectSessionInUrl on by default and will consume and clear it.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashError = hash.get("error_description") ?? hash.get("error");
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    // The fragment must say it is a RECOVERY. Without this check any fragment
    // carrying a session would open the form, which is the "ordinary session
    // is good enough" hole this whole page is built to avoid.
    const isRecovery = hash.get("type") === "recovery";

    // Whether the CURRENT url still carries a recovery answer of any shape.
    //
    // The scrub below is a `history.replaceState`, and Next syncs native
    // history calls into `useSearchParams` — so scrubbing empties `code` /
    // `linkError`, this effect's deps change, and it re-runs against the URL it
    // just emptied. Re-deriving from that replaces a real answer ("that link
    // expired") with the catch-all ("this page needs a reset link"), which is
    // the user-blaming copy this page exists to avoid. It shipped that way for
    // about ten minutes on 2026-08-15 and the smoke suite called it "flaky".
    //
    // The same re-run also lands on the PKCE success path, where scrubbing
    // `?code=` would tear the form out from under someone mid-reset.
    const hasAnswer = Boolean(code || linkError || hashError || accessToken);
    if (settledRef.current && !hasAnswer) return;

    let cancelled = false;
    // Drop the one-time credential out of the address bar so it isn't left in
    // history, or leaked by a Referer header on the next navigation. This runs
    // on EVERY terminal state, not just success: `setSession` is a network
    // call, so it can fail transiently on a token that is still perfectly
    // valid, and the old code left that live access/refresh pair sitting in the
    // URL and in history precisely on the path where something went wrong.
    const settle = (next: Phase, why = "") => {
      if (cancelled) return;
      // Before the scrub, so the re-run the scrub provokes sees it.
      settledRef.current = true;
      window.history.replaceState({}, "", "/reset-password");
      setReason(why);
      setPhase(next);
    };
    const expired = "That link has expired or has already been used.";

    // Deferred by a microtask so no setState runs synchronously in the effect
    // body. Two of the three branches await the network anyway.
    Promise.resolve().then(async () => {
      const combinedError = linkError ?? hashError;
      if (combinedError) return settle("invalid", expired);

      const supabase = createClient();

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          // Also the "opened in a different browser" case: the PKCE verifier
          // is a cookie, so a link requested on a phone and opened on a
          // desktop lands here with a perfectly valid, unusable code.
          return settle(
            "invalid",
            "This link could not be verified. If you opened it in a different browser than you requested it from, request a new one here.",
          );
        }
      } else if (accessToken && refreshToken && isRecovery) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) return settle("invalid", expired);
      } else {
        return settle("invalid", "This page needs a reset link to work.");
      }

      settle("ready");
    });

    return () => {
      cancelled = true;
    };
  }, [code, linkError, hashTick]);

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

    // Sign out EVERYWHERE, then make them sign in with the new password.
    //
    // Global scope is the point. A reset is what someone does when they think
    // their account is compromised, so every other live session has to die
    // with the old password — otherwise the intruder keeps the session they
    // already had and the reset accomplishes nothing. It also means the new
    // password gets proven once, here, instead of assumed.
    await supabase.auth.signOut();
    router.replace("/signin?reset=1");
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
        <p className="text-sm text-[var(--good)]">
          Password updated. Signing you out of all devices — taking you to sign
          in…
        </p>
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
