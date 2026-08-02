"use client";

// The app's on/off switch. One component because there were two byte-identical
// copies of this markup (Quick Add and True Time sharing), and they carried two
// copies of the same bug.
//
// THE BUG, so nobody reintroduces it: the knob used to be an `inline-block`
// span. `<button>` has `text-align: center` in the UA stylesheet and Tailwind's
// preflight does not reset it, so the knob was centred in the 40px track
// instead of resting against its left edge — measured at 12px from the pill's
// left edge when it should be 2px, and overhanging the right edge by 8px in the
// ON state. It read as a broken toggle in both positions.
//
// The fix is that the knob is ABSOLUTELY positioned. The button is already
// `relative`, so `left-0 top-0` anchors it to the padding box — inside the 2px
// transparent border — and the 20px translate lands it flush right. Text
// alignment can no longer reach it. Do not make this `inline-block` again.

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  // Describes what the switch does, for screen readers. The visible text
  // belongs to the surrounding row, so this is the only accessible name.
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
      // The ::after is an invisible 44px-square hit area over a 44x24 control,
      // so the tap target clears the accessibility minimum without the pill
      // itself getting bigger.
      className="relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 after:absolute after:-inset-2.5 after:content-['']"
      style={{ background: checked ? "var(--brand)" : "var(--bg-4)" }}
    >
      <span
        className="pointer-events-none absolute left-0 top-0 block h-5 w-5 rounded-full shadow transition-transform"
        style={{
          background: "var(--fg-0)",
          transform: `translateX(${checked ? "20px" : "0px"})`,
        }}
      />
    </button>
  );
}
