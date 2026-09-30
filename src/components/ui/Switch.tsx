"use client";

// The app's on/off switch: the design's labelled OFF | ON block. Both
// positions are named on the control itself, so state never depends on colour
// or on where a knob sits. Styling is `.switch` in styles/ui-controls.css.
//
// `label` is the ONLY accessible name (the visible text belongs to the
// surrounding row, and tests assert the name matches that row's heading, per
// WCAG 2.5.3). The OFF/ON words are aria-hidden so they never leak into the
// name; state is carried by aria-checked.
//
// The old knob bug (an inline-block knob centred by the button's UA
// text-align) is gone with the knob. There is nothing to position now: two
// grid cells in an inline-flex row.

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  // Describes what the switch does, for screen readers.
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="switch"
    >
      <span className="off" aria-hidden="true">OFF</span>
      <span className="on" aria-hidden="true">ON</span>
    </button>
  );
}
