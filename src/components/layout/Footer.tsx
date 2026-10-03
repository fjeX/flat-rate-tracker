"use client";

// App footer for the authenticated area (final.html .footer). Holds the
// secondary links (FAQ / About / Contact) and the Report a Bug and Request a
// Feature triggers, which open their modals. Signed-in only: it
// renders inside the (app) layout, so it's never shown to logged-out visitors.
import { useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ReportBugModal } from "@/components/bug-report/ReportBugModal";
import { RequestFeatureModal } from "@/components/feature-request/RequestFeatureModal";
import { Icon } from "./icons";

const LINKS = [
  { label: "FAQ", href: "/faq" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function Footer({ isAdmin = false }: { isAdmin?: boolean }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

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
        <button type="button" onClick={() => setRequestOpen(true)} className="footer-link">
          <Icon name="idea" small />
          Request a Feature
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
      <RequestFeatureModal open={requestOpen} onClose={() => setRequestOpen(false)} />
    </footer>
  );
}
