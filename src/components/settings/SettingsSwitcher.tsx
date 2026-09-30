"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Zone } from "@/components/ui/Zone";

// The hash as an external store: read during render (no setState in an
// effect), "" on the server and while hydrating so the first client render
// matches the HTML, then the real hash a frame later.
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
const readHash = () => window.location.hash.replace(/^#/, "");
const noHash = () => "";

export type SettingsSection = {
  /** URL hash and select value: "pay-rates", "appearance"… */
  id: string;
  /** The row's name in the list and the dropdown. */
  name: string;
  /** The zone the setting sits under when shown: Tracking, Logging, Appearance, Data. */
  group: string;
  /** The setting itself (a SettingRow, or Appearance's own layout). */
  content: ReactNode;
};

/**
 * Settings as the mock draws it (final.html screen-settings, and Liem's
 * 2026-09-30 call): ONE setting on display at a time, and the rest listed in
 * a "More settings" zone at the right. Pay Rates opens by default; on a
 * phone the list becomes a dropdown above the setting so it can be reached
 * without scrolling past what is on display.
 *
 * The hash is the state (`/settings#appearance` from the Account page lands
 * on Appearance), written with replaceState so the back button is not
 * peppered with settings clicks.
 */
export function SettingsSwitcher({
  sections,
  defaultId,
}: {
  sections: SettingsSection[];
  defaultId: string;
}) {
  // What the tech picked in this visit wins; otherwise the hash the page was
  // opened with (the Account page links to #appearance); otherwise Pay Rates.
  const [picked, setPicked] = useState<string | null>(null);
  const hash = useSyncExternalStore(subscribeHash, readHash, noHash);
  const active =
    picked ?? (sections.some((s) => s.id === hash) ? hash : defaultId);

  function show(id: string) {
    setPicked(id);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {}
    // The setting on display is above the list on a phone, so bring it back
    // into view once it changes.
    document.getElementById("stg-shown")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const current = sections.find((s) => s.id === active) ?? sections[0];
  const others = sections.filter((s) => s.id !== current.id);

  return (
    <div className="stg-grid">
      <div>
        {/* Phone: the same list as a dropdown, above the setting. */}
        <label className="stg-pick field">
          <span className="field-label">Setting</span>
          <select className="input" value={current.id} onChange={(e) => show(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Zone id="stg-shown" name={current.group} className="stg-shown">
          {current.content}
        </Zone>
      </div>
      <div>
        <Zone name="More settings" className="stg-more">
          <ul className="rowlist">
            {others.map((s) => (
              <li key={s.id}>
                <button type="button" className="rowbtn" onClick={() => show(s.id)}>
                  <span>{s.name}</span>
                  <svg className="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </Zone>
      </div>
    </div>
  );
}
