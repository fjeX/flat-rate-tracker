"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

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
  }, [error]);

  return (
    <main style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", textAlign: "center" }}>
      <p style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>App crashed</p>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 12px", color: "var(--fg-1)" }}>The app hit an error it couldn&apos;t recover from</h2>
      <p style={{ fontSize: 13, color: "var(--fg-2)", maxWidth: 320, margin: "0 0 20px" }}>
        Reload the page — your logged hours are saved on the server.
      </p>
      <button
        onClick={reset}
        style={{ background: "var(--brand)", color: "var(--brand-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "8px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
      >
        Reload
      </button>
    </main>
  );
}
