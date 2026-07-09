import Link from "next/link";
import { DIR_NAMES, previewHref, type Dir, type PageKey } from "./components";

const PAGES: PageKey[] = ["dashboard", "log", "history"];

export default function PreviewIndex() {
  return (
    <div className="pv-index">
      <h1>FRT — Design direction previews</h1>
      <p>
        Three token + primitive sets over the same three pages, static mock data. Use the bar
        at the top of any preview to flip direction and theme; add <code>?chrome=0</code> for
        clean screenshots.
      </p>
      {(["a", "b", "c"] as Dir[]).map((dir) => (
        <section key={dir}>
          <h2>
            {dir.toUpperCase()} — {DIR_NAMES[dir]}
          </h2>
          <ul>
            {PAGES.map((p) => (
              <li key={p}>
                <Link href={previewHref(dir, p, "dark", true)}>{p} · dark</Link>
                {" / "}
                <Link href={previewHref(dir, p, "light", true)}>light</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
