"use client";

// "Continue with Google" button for /signin and /signup.
//
// Unlike the email/password flow (server actions), OAuth has to start in the
// browser: signInWithOAuth redirects the tab to Google and relies on the
// browser-side PKCE code verifier, which the /auth/callback handler then reads
// back. So this uses the browser Supabase client, not the server one.
//
// Phase 5: a line button (the app's own edge and ink) carrying Google's mark.
// The mark keeps Google's colours; nothing else on the button is theirs.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

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
      <Button variant="line" block busy={loading} disabled={loading} onClick={signInWithGoogle} className="auth-google">
        {/* Brand mark lives in /public — Google's colors, not ours */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/google-logo.svg" alt="" width={18} height={18} aria-hidden />
        {loading ? "Redirecting…" : "Continue with Google"}
      </Button>
      {error && (
        <p className="auth-google-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
