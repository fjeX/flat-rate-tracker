// Deterministic tag → category-hue token. The same tag always lands on the
// same --tag-hue-N slot (defined per-theme in globals.css), so new tags get
// a color without any code change. Case-insensitive so "Brakes" and
// "brakes" match, mirroring how the browse hook de-dupes tags.
export function tagHueVar(tag: string | undefined): string {
  if (!tag) return "var(--bg-3)";
  const key = tag.toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `var(--tag-hue-${h % 8})`;
}
