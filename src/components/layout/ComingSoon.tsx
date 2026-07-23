// Placeholder body for footer pages (FAQ / About / Contact) that aren't written
// yet. Keeps the footer links functional instead of 404-ing; the real content
// gets dropped in later.
export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <main className="app-main" style={{ paddingBottom: 64 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 className="section-title" style={{ marginBottom: 4 }}>
          {title}
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--fg-2)" }}>{blurb}</p>
      </div>
      <div
        className="card"
        style={{ padding: 24, textAlign: "center", color: "var(--fg-2)", fontSize: 14 }}
      >
        Coming soon.
      </div>
    </main>
  );
}
