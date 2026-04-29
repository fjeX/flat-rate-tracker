# Scan Details UI — OCR Result Panel Redesign

## What changed

Replaced the raw "Show raw OCR" debug dropdown with a clean **Scan details** panel aimed at regular users.

### Before
- Toggle labeled "Show raw OCR" / "Hide raw OCR" — visible after every scan
- Expanded panel showed raw Tesseract `<pre>` dumps and `Extracted: {...}` JSON blobs
- No smart show/hide logic — always appeared after any scan

### After
- Toggle labeled **"Scan details"** / **"Hide details"**
- Panel hidden entirely when scan confidence is high and all fields were filled — no clutter on a clean scan
- Auto-expands when confidence is low or fields were missed — surfaces the info exactly when it's useful
- Each field shows a human-readable card:
  - Field label (e.g., "RO Number", "Year / Make / Model")
  - Colored result badge: ✅ green (found), ⚠️ yellow (partial or read but not matched), ✖ gray (not detected)
  - Truncated raw scan text below — so the user can see what the camera actually picked up

## Files changed

| File | Change |
|---|---|
| `src/components/forms/ScanRoButton.tsx` | Full redesign of debug section; added `confidence` state, `getRegionStatus` helper, `AlertTriangle` icon import |

## Logic details

**Visibility condition:** `!(status === "success" && confidence === "high")` — hides the section entirely on a confident, complete scan.

**Auto-expand:** `setShowDebug(result.confidence === "low")` — opens the panel automatically when something was missed, so the user doesn't have to hunt for why a field is blank.

**`getRegionStatus` helper:** per-field logic that maps raw `RegionDebug` data to `{ icon: "success" | "partial" | "none", label: string }` — drives the badge color and text without leaking internal data structures into the render.
