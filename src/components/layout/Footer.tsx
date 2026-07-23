"use client";

// App footer for the authenticated area. Holds the secondary links (FAQ / About /
// Contact — placeholder pages for now) and the Report a Bug trigger, which opens
// the report modal. Signed-in only: it renders inside the (app) layout, so it's
// never shown to logged-out visitors.
import { useState } from "react";
import Link from "next/link";
import { Bug, ShieldCheck } from "lucide-react";
import { ReportBugModal } from "@/components/bug-report/ReportBugModal";

const LINKS = [
  { label: "FAQ", href: "/faq" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function Footer({ isAdmin = false }: { isAdmin?: boolean }) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <footer className="border-t border-[var(--line)] py-8">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-7 max-sm:flex-col max-sm:items-start max-sm:gap-4 max-sm:px-[18px]">
        <div className="flex flex-wrap items-center gap-5">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="inline-flex min-h-[44px] items-center whitespace-nowrap font-mono text-sm text-[var(--fg-3)] no-underline transition-colors hover:text-[var(--fg-1)]"
            >
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap font-mono text-sm text-[var(--fg-3)] transition-colors hover:text-[var(--fg-1)]"
          >
            <Bug className="h-4 w-4" aria-hidden="true" />
            Report a Bug
          </button>
          {isAdmin && (
            <Link
              href="/admin/bugs"
              className="inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap font-mono text-sm text-[var(--fg-3)] no-underline transition-colors hover:text-[var(--fg-1)]"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Admin
            </Link>
          )}
        </div>
        <span className="font-mono text-xs text-[var(--fg-3)]">© 2026 Flat Rate Tracker</span>
      </div>

      <ReportBugModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </footer>
  );
}
