"use client";

import "./globals.css";
import { useEffect } from "react";
import { reportError } from "@/lib/report-error";
import { isStaleDeployError } from "@/lib/action-error";
import { LogoMark, LogoWord } from "@/components/layout/icons";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    void reportError(error);
    // A tab left open across a redeploy holds Server Action IDs the new build
    // no longer has (bug 33cbab9e). Nothing is wrong with the app — a reload
    // picks up the current build. Guarded so a persistent failure can't loop.
    if (isStaleDeployError(error)) {
      try {
        const key = "frt:stale-deploy-reloaded";
        if (sessionStorage.getItem(key) !== (error.digest ?? "1")) {
          sessionStorage.setItem(key, error.digest ?? "1");
          window.location.reload();
        }
      } catch {
        // sessionStorage unavailable — fall through to the manual Reload button.
      }
    }
  }, [error]);

  return (
    // The root boundary replaces the root layout, so it brings its own <html>
    // with the same theme defaults the layout renders; tokens come from the
    // globals.css import above.
    <html lang="en" data-theme="dark" data-accent="blue" data-panel="accent">
      <body>
        <main className="err-page">
          <div className="logo err-logo">
            <LogoMark />
            <LogoWord />
          </div>
          <Card name="App crashed" nameAs="h1" paddedLg className="err-card">
            <p className="err-title">The app hit an error it couldn&apos;t recover from</p>
            <p className="err-desc">Reload the page — your logged hours are saved on the server.</p>
            <Button variant="go" onClick={reset}>Reload</Button>
          </Card>
        </main>
      </body>
    </html>
  );
}
