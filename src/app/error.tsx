"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

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
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, background: "var(--bg-0, #0a0a0c)", color: "var(--fg-0, #f5f5f4)", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "var(--fg-2, #a3a09a)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>App crashed</p>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 16px" }}>The app hit an error it couldn&apos;t recover from</h1>
          <p style={{ fontSize: 14, color: "var(--fg-3, #8a867f)", maxWidth: 360, margin: "0 0 24px" }}>
            Reload the page — your logged hours are saved on the server.
          </p>
          <button
            onClick={reset}
            style={{ background: "var(--brand, #ea580c)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
