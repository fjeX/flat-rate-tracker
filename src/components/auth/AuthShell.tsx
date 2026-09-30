import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark, LogoWord } from "@/components/layout/icons";
import { Card } from "@/components/ui/Card";

/**
 * The signed-out frame (phase 5): the tower mark over one zone panel on the
 * wall, centred. Sign in, Sign up, Forgot and Reset all draw through it, so
 * the four pages can't drift apart again.
 *
 * `title` is the panel's zone tab AND the page's h1 (nameAs="h1"): a
 * signed-out page has exactly one heading, and the tab is where the mock
 * puts a panel's name. Copy inside is the page's own.
 */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <Link href="/" className="logo auth-logo" aria-label="Flat Rate Tracker, go to the front page">
        <LogoMark />
        <LogoWord />
      </Link>
      <Card name={title} nameAs="h1" paddedLg className="auth-card">
        {children}
      </Card>
    </main>
  );
}

/** The ruled "or" between the password form and the Google button. */
export function AuthOr() {
  return (
    <div className="auth-or" aria-hidden="true">
      <span>or</span>
    </div>
  );
}
