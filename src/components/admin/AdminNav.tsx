// Switcher between the admin inboxes. The footer's Admin link lands on Bugs;
// this is how you get from there to Requests and back.
import Link from "next/link";

const TABS = [
  { href: "/admin/bugs", label: "Bug reports" },
  { href: "/admin/requests", label: "Feature requests" },
] as const;

export function AdminNav({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="adm-nav" aria-label="Admin inboxes">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`btn ${t.href === current ? "btn-go" : "btn-line"}`}
          aria-current={t.href === current ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
