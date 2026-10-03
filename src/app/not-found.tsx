import Link from "next/link";
import { LogoMark, LogoWord } from "@/components/layout/icons";
import { Card } from "@/components/ui/Card";

export default function NotFound() {
  return (
    <main className="err-page">
      <div className="logo err-logo">
        <LogoMark />
        <LogoWord />
      </div>
      <Card name="No page here" nameAs="h1" paddedLg className="err-card">
        <p className="err-title">That link doesn&apos;t go anywhere in Flat Rate Tracker.</p>
        <p className="err-desc">It may have been typed wrong or the page moved.</p>
        <Link href="/log" className="btn btn-go">Log an RO</Link>
        <Link href="/dashboard" className="btn btn-line">Go to dashboard</Link>
      </Card>
    </main>
  );
}
