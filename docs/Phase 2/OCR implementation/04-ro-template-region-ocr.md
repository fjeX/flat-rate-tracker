# Session Handoff — RO Template / Region-Based OCR

## What changed this session

The OCR scan now supports a **RO Template** — a one-time setup where the tech uploads a sample RO photo and draws labeled boxes over each field. On every subsequent scan, only those regions are cropped and read by Tesseract instead of the full noisy page. Dramatically better accuracy for shop-specific RO layouts.

## Architecture

**Template storage**
- Template image: Supabase Storage bucket `ro-templates`, path `{userId}/template`
- Region coordinates + image path: `user_settings.ro_template` (new JSONB column)
- Coordinates are percentages (0–100) of image dimensions — resolution-independent, works regardless of scan photo size

**Four mappable fields**
| FieldId | Label | Color |
|---|---|---|
| `roNumber` | RO Number | Orange |
| `vehicle` | Year / Make / Model | Blue |
| `vin` | VIN | Green |
| `opCodes` | Op Codes | Purple |

**Scan flow (with template)**
1. Tech picks a photo of a real RO
2. For each mapped region: crop via `<canvas>` → run Tesseract on the crop → call `extractFieldFromText(text, field, library)`
3. Merge partial results → build final `OcrResult`
4. Falls back to full-image scan if no template is configured

## Key files

| File | Role |
|---|---|
| `supabase/migrations/20260425000000_ro_template.sql` | Adds `ro_template` column + `ro-templates` Storage bucket + RLS |
| `src/lib/types.ts` | `FieldId`, `FieldRegion`, `RoTemplate` types; `UserSettings.roTemplate` |
| `src/lib/ocr.ts` | `cropImageRegion()` (canvas crop → Blob) + `extractFieldFromText()` |
| `src/app/actions/ro-template.ts` | `saveRoTemplateMetadata()` + `deleteRoTemplateAction()` |
| `src/components/settings/RoTemplateEditor.tsx` | Drag-to-draw modal UI (pointer events, ghost box, resize handles) |
| `src/components/settings/RoTemplateCard.tsx` | Settings page card — shows mapped fields, opens editor |
| `src/app/(app)/settings/page.tsx` | Wires in `RoTemplateCard` |
| `src/components/forms/ScanRoButton.tsx` | Uses template regions when available; falls back to full scan |
| `src/app/(app)/log/page.tsx` | Fetches `settings.roTemplate` and passes to `LogRoForm` |
| `src/components/forms/LogRoForm.tsx` | Accepts `roTemplate` prop, passes to `ScanRoButton` |

## Migration status
- Applied locally: ✅ `npx supabase migration up` ran clean
- Production Supabase: ❌ not yet pushed — must run `npx supabase db push` after `supabase link` before shipping

## Running state
- Branch: `master` (committed as `2abe20e`)
- Dev server: not running — start with `npm run dev` in `projects/flat-rate-tracker/`
- Build: ✅ 0 errors, all 12 routes

## Verification steps
1. `npm run build` — should compile clean
2. `/settings` — new "RO Scan Template" card appears above Data
3. Click "Set Up Template" → upload any RO photo → draw boxes → Save
4. `/log` → Scan RO → result should only read mapped regions (faster, cleaner)
5. Delete template → scan falls back to full-image mode

## Deferred / open

- **Production migration** — `20260425000000_ro_template.sql` is local only. Must push before shipping.
- **HEIC support** — iOS photos in HEIC format are not accepted (only JPEG/PNG/WEBP). Users need to convert first. Could add `heic2any` or just document the limitation.
- **Template preview thumbnail** — Settings card shows field tags but no image preview. Low priority but would improve UX.
- **Multiple templates** — Currently one template per user. Some shops have multiple RO formats (e.g. warranty vs. customer pay). Not needed for Phase 2 but worth noting for later.
- **Real-world accuracy testing** — Template feature is built but untested against actual printed ROs. Next step is Liem testing it at the shop with his real RO forms.
- **Confidence threshold** — No minimum confidence gate on Tesseract output. If scans still produce bad fills, add a `data.confidence` check in `ScanRoButton.tsx`.

## Pick up here
Run the app, go to Settings, set up a template against a real printed RO from Liem's shop. Note which fields parse correctly and which still miss. Then either tune the regex patterns in `ocr.ts` or adjust the region box placements.
