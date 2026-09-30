"use client";

// App footer for the authenticated area (final.html .footer). Holds the
// secondary links (FAQ / About / Contact — placeholder pages for now) and the
// Report a Bug trigger, which opens the report modal. Signed-in only: it
// renders inside the (app) layout, so it's never shown to logged-out visitors.
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ReportBugModal } from "@/components/bug-report/ReportBugModal";
import { Icon } from "./icons";

const LINKS = [
  { label: "FAQ", href: "/faq" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function Footer({ isAdmin = false }: { isAdmin?: boolean }) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <footer className="footer">
      <div className="footer-in">
        {LINKS.map((l) => (
          <Link key={l.label} href={l.href} className="footer-link">
            {l.label}
          </Link>
        ))}
        <button type="button" onClick={() => setReportOpen(true)} className="footer-link">
          <Icon name="report" small />
          Report a Bug
        </button>
        {isAdmin && (
          <Link href="/admin/bugs" className="footer-link">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Admin
          </Link>
        )}
        <span className="copy">© 2026 Flat Rate Tracker</span>
      </div>

      <ReportBugModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </footer>
  );
}
