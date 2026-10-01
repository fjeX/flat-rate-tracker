import { Card } from "@/components/ui/Card";

// Placeholder body for footer pages (FAQ / About / Contact) that aren't written
// yet. Keeps the footer links functional instead of 404-ing; the real content
// gets dropped in later. Styles: page-landing.css (`lp-soon`).
export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <main className="lp-soon">
      <div className="pagehead">
        <div className="grow">
          <h1>{title}</h1>
          <p>{blurb}</p>
        </div>
      </div>
      <Card paddedLg>Coming soon.</Card>
    </main>
  );
}
