"use client";

// Last-resort boundary for a crash in the ROOT LAYOUT itself. src/app/error.tsx
// can't catch that: Next renders error.tsx inside the root layout, so when the
// layout is what threw, there is nothing to render it in. Until 2026-10-08 FRT
// had no global-error, so such a crash showed Next's bare default page and
// reported nothing.
//
// It replaces the whole document, so it brings its own <html>/<body> and plain
// inline styles: globals.css, the theme attributes and the fonts all live in the
// layout that just failed.
import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // Sentry + client_errors, same reporter as the other boundaries.
    void reportError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#111",
          color: "#eee",
          padding: 16,
        }}
      >
        <main style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>The app hit an error it couldn&apos;t recover from</h1>
          <p style={{ margin: "0 0 20px", opacity: 0.8 }}>
            Reload the page. Your logged hours are saved on the server.
          </p>
          {/* A full reload, not reset(): the root layout itself failed, so
              re-rendering the same tree in place would just throw again. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ font: "inherit", padding: "10px 20px", borderRadius: 8, border: 0, cursor: "pointer" }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
