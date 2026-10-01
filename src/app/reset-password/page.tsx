"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { Field } from "@/components/ui/Field";
import { StatusField } from "@/components/ui/StatusField";

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
  return <AuthShell title="Set a new password">{children}</AuthShell>;
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

  // Identity anchor for password managers (and the browser's "password forms
  // should have a username field" advisory). This component never receives the
  // email — identity arrives only through the recovery-token exchange above —
  // so it has to be asked for, once, after that exchange has already succeeded.
  //
  // STRICTLY ADDITIVE, and deliberately so: this runs only in the "ready"
  // phase, nothing awaits it, and no phase, error, or submit path reads it. If
  // it fails, is slow, or the page unmounts first, `username` simply stays null
  // and the form renders exactly as it does today — a NULL RESULT MUST RENDER
  // NO FIELD AT ALL, because an empty username anchor invites a password
  // manager to save the new credential against a blank identity, which is worse
  // than having no anchor.
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setUsername(data.user?.email ?? null);
      })
      .catch(() => {
        // Cosmetic enhancement on a security-critical path: swallow and skip.
      });
    return () => {
      cancelled = true;
    };
  }, [phase]);

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
      {phase === "verifying" && <p className="auth-lede">Checking your link…</p>}

      {phase === "invalid" && (
        <>
          <StatusField tag="Fix" role="alert" inset>
            <p>{reason}</p>
          </StatusField>
          <p className="auth-lede">Reset links are single-use. Request a fresh one and it&apos;ll work.</p>
          <div className="auth-stack">
            <Link href="/forgot-password" className="btn btn-go btn-block">
              Request a new link
            </Link>
            <Link href="/signin" className="btn btn-quiet btn-block">
              Back to sign in
            </Link>
          </div>
        </>
      )}

      {phase === "ready" && (
        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <StatusField tag="Fix" role="alert" inset>
              <p>{error}</p>
            </StatusField>
          )}
          {/*
            The wrapper is UNCONDITIONAL and the input inside it is not, so this
            slot exists in both states and the two password labels below always
            hold the same child index. Flipping the input itself on and off would
            insert an element ahead of them, shifting them by one — React
            reconciles these children by position, so the labels would remount
            and steal focus from someone mid-typing at the exact moment
            getUser() resolves. `sr-only` is position:absolute and the div is
            empty when username is null, so it contributes nothing to layout.
          */}
          <div className="sr-only">
            {username && (
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={username}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
              />
            )}
          </div>
          <Field label="New password" htmlFor="new_password" hint="At least 8 characters.">
            <input
              id="new_password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm_new_password">
            <input
              id="confirm_new_password"
              type="password"
              required
              autoComplete="new-password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          <button type="submit" className="btn btn-go btn-block" disabled={pending} aria-busy={pending || undefined}>
            {pending ? "Saving…" : "Set new password"}
          </button>
        </form>
      )}

      {phase === "done" && (
        <StatusField tag="Saved" role="status" inset>
          <p>Password updated. Signing you out of all devices — taking you to sign in…</p>
        </StatusField>
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
          <p className="auth-lede">Checking your link…</p>
        </Shell>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
