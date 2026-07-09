"use client";

// "Continue with Google" button for /signin and /signup.
//
// Unlike the email/password flow (server actions), OAuth has to start in the
// browser: signInWithOAuth redirects the tab to Google and relies on the
// browser-side PKCE code verifier, which the /auth/callback handler then reads
// back. So this uses the browser Supabase client, not the server one.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function GoogleButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    // On success the browser is already navigating to Google, so we only get
    // here if kicking off the redirect failed.
    if (error) {
      setError("Could not start Google sign-in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={loading}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Brand mark lives in /public — Google's colors, not ours */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/google-logo.svg" alt="" width={16} height={16} aria-hidden />
        {loading ? "Redirecting…" : "Continue with Google"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-[var(--bad)]">{error}</p>
      )}
    </div>
  );
}
