import Link from "next/link";
import { GuestStoreProvider } from "@/lib/guest/context";
import { Header } from "@/components/layout/Header";
import { GuestNav } from "@/components/guest/GuestNav";

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuestStoreProvider>
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        <div className="border-b border-amber-900/40 bg-amber-950/30 px-4 py-2 text-center text-xs text-amber-300">
          Guest mode — ROs you log won&apos;t be saved after you close this tab.{" "}
          <Link href="/signup" className="underline hover:text-amber-100 transition-colors">
            Create a free account
          </Link>{" "}
          to keep your data.
        </div>
        <Header userEmail={null} />
        <GuestNav />
        <div className="flex-1">{children}</div>
      </div>
    </GuestStoreProvider>
  );
}
