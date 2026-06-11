"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <html>
      <body style={{ margin: 0, background: "#09090b", color: "#f4f4f5", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#a1a1aa", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Something went wrong</p>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 16px" }}>Unexpected error</h1>
          <p style={{ fontSize: 14, color: "#71717a", maxWidth: 360, margin: "0 0 24px" }}>
            An unexpected error occurred. Your data is safe — try refreshing the page.
          </p>
          <button
            onClick={reset}
            style={{ background: "#ea580c", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
