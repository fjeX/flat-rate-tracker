"use client";

import { useId, useRef, useState } from "react";
import { saveAppearance } from "@/app/actions/appearance";
import { writeStored } from "@/lib/client-storage";
import { ACCENT_KEY, THEME_KEY, applyThemeToRoot, type Accent, type Theme } from "@/lib/theme";
import { Badge } from "@/components/ui/Badge";

interface Props {
  initialTheme: Theme;
  initialAccent: Accent;
  /** account: also saved to the account. guest: this browser only, no server call. */
  mode: "account" | "guest";
  /** Tighter layout for a phone dialog: one column, notes hidden. */
  compact?: boolean;
}

const THEME_OPTIONS: { value: Theme; name: string; note: string }[] = [
  { value: "light", name: "Light", note: "For a bright bay" },
  { value: "dark", name: "Dark", note: "Standard. Green-grey, for a dim bay" },
  { value: "dark-graphite", name: "Graphite", note: "Dark, plain grey" },
  { value: "dark-pitch", name: "Pitch", note: "Dark, near black. Easiest on an OLED phone" },
];

const ACCENT_OPTIONS: { value: Accent; name: string; note?: string }[] = [
  { value: "blue", name: "Blue", note: "Standard" },
  { value: "orange", name: "Orange" },
  { value: "teal", name: "Teal" },
  { value: "red", name: "Red", note: "Cherry, not the warning red" },
  { value: "ink", name: "Ink", note: "No colour" },
];

type Status = { kind: "saved" | "bad"; text: string } | null;

function Check() {
  return (
    <svg className="appearance-ic" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9.5 16.2l-4.7-4.7L3 13.3l6.5 6.5L21.5 7.8 19.7 6z" />
    </svg>
  );
}

function ThemeIcon({ flip }: { flip: boolean }) {
  return (
    <svg
      className={`appearance-ic${flip ? " appearance-ic-flip" : ""}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
    >
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.5v15a7.5 7.5 0 0 1 0-15z" />
    </svg>
  );
}

function OptionState() {
  return (
    <span className="opt-state">
      <span>Selected</span>
      <Check />
    </span>
  );
}

export function AppearanceCard({ initialTheme, initialAccent, mode, compact }: Props) {
  const uid = useId();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [accent, setAccent] = useState<Accent>(initialAccent);
  const [status, setStatus] = useState<Status>(null);
  // Only the latest choice may write the status line; an older save resolving
  // late must not overwrite it.
  const seq = useRef(0);

  async function choose(nextTheme: Theme, nextAccent: Accent, label: string) {
    setTheme(nextTheme);
    setAccent(nextAccent);
    // The look applies at once and stays applied whatever the server says.
    writeStored(THEME_KEY, nextTheme);
    writeStored(ACCENT_KEY, nextAccent);
    applyThemeToRoot(document.documentElement, nextTheme, nextAccent);

    const mine = ++seq.current;
    if (mode === "guest") {
      setStatus({ kind: "saved", text: `${label} saved to this browser. It applies on every page.` });
      return;
    }
    let error: string | undefined;
    try {
      ({ error } = await saveAppearance({ theme: nextTheme, accent: nextAccent }));
    } catch {
      error = "Could not reach the server.";
    }
    if (mine !== seq.current) return;
    setStatus(
      error
        ? { kind: "bad", text: `${label} applied here but not saved to your account: ${error}` }
        : { kind: "saved", text: `${label} saved to your account. It applies on every page.` },
    );
  }

  return (
    <div className={`appearance${compact ? " appearance-compact" : ""}`}>
      <fieldset className="set-group">
        <legend className="field-label">Theme</legend>
        <div className="opts">
          {THEME_OPTIONS.map((o) => (
            <label className="opt" key={o.value}>
              <input
                type="radio"
                name={`${uid}-theme`}
                value={o.value}
                checked={theme === o.value}
                onChange={() => choose(o.value, accent, `${o.name} theme`)}
              />
              <span className="opt-box">
                <ThemeIcon flip={o.value !== "light"} />
                <span>
                  <span className="opt-name">{o.name}</span>
                  <span className="opt-note">{o.note}</span>
                </span>
                <OptionState />
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="set-group">
        <legend className="field-label">Accent colour</legend>
        <p className="set-help">
          Colours the main button, links, the page you are on and what you have selected. Green and
          red stay reserved for good and bad.
        </p>
        <div className="opts">
          {ACCENT_OPTIONS.map((o) => (
            <label className="opt" key={o.value}>
              <input
                type="radio"
                name={`${uid}-accent`}
                value={o.value}
                checked={accent === o.value}
                onChange={() => choose(theme, o.value, `${o.name} accent`)}
              />
              <span className="opt-box">
                <span className="swatch" data-swatch={o.value} aria-hidden="true">
                  Aa
                </span>
                <span>
                  <span className="opt-name">{o.name}</span>
                  {o.note && <span className="opt-note">{o.note}</span>}
                </span>
                <OptionState />
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="set-group">
        <p className="field-label" id={`${uid}-prev`}>
          How it looks
        </p>
        <div className="preview" role="group" aria-labelledby={`${uid}-prev`}>
          <button className="btn btn-go" type="button">
            Save RO
          </button>
          <span className="preview-link">View all</span>
          <Badge chip selected>
            LOF 0.5h
          </Badge>
        </div>
      </div>

      {/* The live region is always mounted; only its contents come and go.
          A region that is itself inserted or unhidden is announced
          inconsistently, so the first save could pass in silence. */}
      <div role="status">
        {status && (
          <div
            className={`appearance-status${status.kind === "bad" ? " is-bad" : ""}`}
            style={{ marginTop: "var(--s4)" }}
          >
            <span className="appearance-status-tag">{status.kind === "bad" ? "Fix" : "Saved"}</span>
            <p>{status.text}</p>
          </div>
        )}
      </div>
    </div>
  );
}
