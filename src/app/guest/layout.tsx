import { GuestStoreProvider } from "@/lib/guest/context";
import { Header } from "@/components/layout/Header";
import { GuestNav, GuestDirectoryButton } from "@/components/guest/GuestNav";
import { ClaimAccountLink } from "@/components/guest/ClaimAccountLink";
import { GuestAppearance } from "@/components/guest/GuestAppearance";

/**
 * Never prerender the guest segment.
 *
 * These pages are "use client" and read "today" in the browser, so Next is free
 * to prerender their shells at `next build` — which bakes the pay period that
 * was current on BUILD DAY into the static HTML. The canary then serves that
 * build-day markup to a browser whose clock is frozen to FIXTURE_NOW, the text
 * disagrees, and React recovers the hydration mismatch by re-rendering from the
 * root. That rewrites <html> from the server props in src/app/layout.tsx
 * (data-theme="dark" data-accent="blue") — so what the <head> theme script set
 * is wiped and the light-mode canary photographs a dark page.
 *
 * Segment config cannot live on the pages themselves ("use client" forbids it),
 * so it lives on the layout and covers the whole /guest segment.
 */
export const dynamic = "force-dynamic";

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuestStoreProvider>
      <div className="shell-frame">
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
        <Header userEmail={null} actions={<GuestDirectoryButton extra={<GuestAppearance />} />} />
        <GuestNav />
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </GuestStoreProvider>
  );
}
