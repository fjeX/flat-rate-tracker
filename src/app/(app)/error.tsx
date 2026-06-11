"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", textAlign: "center" }}>
      <p style={{ fontSize: 12, color: "var(--fg-3, #71717a)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Something went wrong</p>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 12px", color: "var(--fg-1, #f4f4f5)" }}>Unexpected error</h2>
      <p style={{ fontSize: 13, color: "var(--fg-2, #a1a1aa)", maxWidth: 320, margin: "0 0 20px" }}>
        An unexpected error occurred. Your data is safe — try refreshing the page.
      </p>
      <button
        onClick={reset}
        style={{ background: "var(--brand, #ea580c)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
      >
        Try again
      </button>
    </main>
  );
}
