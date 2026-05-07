import Link from "next/link";
import { GuestStoreProvider } from "@/lib/guest/context";
import { Header } from "@/components/layout/Header";
import { GuestNav } from "@/components/guest/GuestNav";

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
          <Link href="/signup" style={{ color: "var(--warn)", fontWeight: 600, textDecoration: "underline" }}>
            Create a free account
          </Link>{" "}
          to keep your data.
        </div>
        <Header userEmail={null} />
        <GuestNav />
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </GuestStoreProvider>
  );
}
