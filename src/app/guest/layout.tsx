import { GuestStoreProvider } from "@/lib/guest/context";
import { Header } from "@/components/layout/Header";
import { GuestNav } from "@/components/guest/GuestNav";
import { ClaimAccountLink } from "@/components/guest/ClaimAccountLink";

/**
 * Never prerender the guest segment.
 *
 * These pages are "use client" and read "today" in the browser, so Next is free
 * to prerender their shells at `next build` — which bakes the pay period that
 * was current on BUILD DAY into the static HTML. The canary then serves that
 * build-day markup to a browser whose clock is frozen to FIXTURE_NOW, the text
 * disagrees, and React recovers the hydration mismatch by re-rendering from the
 * root. That rewrites <html className> from the server prop in
 * src/app/layout.tsx, which has no `theme-light` — so the class the <head>
 * theme script added is wiped and the light-mode canary photographs a dark page.
 *
 * Segment config cannot live on the pages themselves ("use client" forbids it),
 * so it lives on the layout and covers the whole /guest segment.
 */
export const dynamic = "force-dynamic";

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuestStoreProvider>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <div style={{
          borderBottom: "1px solid color-mix(in oklab, var(--warn) 25%, var(--line))",
          background: "color-mix(in oklab, var(--warn) 8%, var(--bg-1))",
          padding: "7px 16px",
          textAlign: "center",
          fontSize: 12,
          color: "var(--warn)",
          letterSpacing: "0.01em",
        }}>
          Guest mode — ROs won&apos;t be saved after you close this tab.{" "}
          <ClaimAccountLink href="/signup" style={{ color: "var(--warn)", fontWeight: 600, textDecoration: "underline" }}>
            Create a free account
          </ClaimAccountLink>{" "}
          to keep your data.
        </div>
        <Header userEmail={null} />
        <GuestNav />
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </GuestStoreProvider>
  );
}
