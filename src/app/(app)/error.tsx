"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";
import { isStaleDeployError } from "@/lib/action-error";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export default function AppError({
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
    <main className="err-page err-page-app">
      <Card name="App crashed" nameAs="h2" paddedLg className="err-card">
        <p className="err-title">The app hit an error it couldn&apos;t recover from</p>
        <p className="err-desc">Reload the page — your logged hours are saved on the server.</p>
        <Button variant="go" onClick={reset}>Reload</Button>
      </Card>
    </main>
  );
}
