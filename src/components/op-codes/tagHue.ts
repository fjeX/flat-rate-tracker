// Deterministic tag → category-hue token. The same tag always lands on the
// same --tag-hue-N slot (defined per-theme in globals.css), so new tags get
// a color without any code change. Case-insensitive so "Brakes" and
// "brakes" match, mirroring how the browse hook de-dupes tags.
//
// A user-set override (settings.tagColors, lowercased tag → slot index) wins
// over the hash so techs can differentiate job types on purpose.

export const TAG_HUE_SLOTS = 8;

export function tagHueSlot(
  tag: string,
  overrides?: Record<string, number>,
): number {
  const key = tag.toLowerCase();
  const chosen = overrides?.[key];
  if (chosen !== undefined && Number.isInteger(chosen) && chosen >= 0 && chosen < TAG_HUE_SLOTS) {
    return chosen;
  }
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % TAG_HUE_SLOTS;
}

export function tagHueVar(
  tag: string | undefined,
  overrides?: Record<string, number>,
): string {
  if (!tag) return "var(--bg-3)";
  return `var(--tag-hue-${tagHueSlot(tag, overrides)})`;
}
