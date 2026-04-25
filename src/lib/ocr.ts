import type { FieldId, FieldRegion, OpCode } from "@/lib/types";

export type OcrResult = {
  roNumber: string;
  year: string;
  make: string;
  model: string;
  vin: string;
  opCodeIds: string[];
  confidence: "high" | "low";
};

// Common makes — used to locate the vehicle line in OCR output.
const KNOWN_MAKES = [
  "Acura","Alfa Romeo","Audi","BMW","Buick","Cadillac","Chevrolet","Chevy",
  "Chrysler","Dodge","Ferrari","Fiat","Ford","Genesis","GMC","Honda","Hummer",
  "Hyundai","Infiniti","Isuzu","Jaguar","Jeep","Kia","Lamborghini","Land Rover",
  "Landrover","Lexus","Lincoln","Lucid","Maserati","Mazda","Mercedes","Mercedes-Benz",
  "Mercury","Mini","Mitsubishi","Nissan","Oldsmobile","Plymouth","Pontiac","Porsche",
  "Ram","Rivian","Saab","Saturn","Scion","Subaru","Suzuki","Tesla","Toyota",
  "Volkswagen","VW","Volvo",
];

// Returns the first match for a pattern or empty string.
function match1(text: string, re: RegExp): string {
  return re.exec(text)?.[1]?.trim() ?? "";
}

export function parseOcrText(rawText: string, library: OpCode[]): OcrResult {
  const text = rawText.replace(/\r/g, "");

  const roNumber = extractRoNumber(text);
  const { year, make, model } = extractVehicle(text);
  const vin = extractVin(text);
  const opCodeIds = extractOpCodes(text, library);

  const fieldsFound = [roNumber, year, make, model].filter(Boolean).length;
  const confidence: "high" | "low" = fieldsFound >= 3 ? "high" : "low";

  return { roNumber, year, make, model, vin, opCodeIds, confidence };
}

// ── Field extractors ─────────────────────────────────────────────────────────
// These are used both by parseOcrText (full-page) and extractFieldFromText
// (region crops). The key difference: region crops may not contain field labels,
// so each extractor tries label-anchored patterns first then falls back to bare
// content patterns.

function extractRoNumber(text: string): string {
  // Label-anchored: "RO# 123456", "Repair Order: 123456", etc.
  const labeled =
    match1(text, /(?:RO\s*#?|Repair\s+Order\s*[:#]?|Work\s+Order\s*[:#]?|WO\s*#?)\s*(\d{4,8})/i) ||
    match1(text, /(?:^|\s)#(\d{4,8})(?:\s|$)/m);
  if (labeled) return labeled;

  // Bare fallback: first standalone 4–8 digit sequence (handles region crops
  // where the label isn't in the frame).
  return match1(text, /\b(\d{4,8})\b/);
}

function extractVehicle(text: string): { year: string; make: string; model: string } {
  // ── Year ──────────────────────────────────────────────────────────────────
  const yearMatch = /\b((?:1|2)(?:9|0)\d{2})\b/.exec(text);
  const year = yearMatch?.[1] ?? "";

  // ── Make ──────────────────────────────────────────────────────────────────
  const upper = text.toUpperCase();
  const normalised = normaliseOcr(upper);

  let make = "";
  let makeIndex = -1;

  for (const m of KNOWN_MAKES) {
    // Try clean text first.
    const idx = upper.indexOf(m.toUpperCase());
    if (idx !== -1) {
      make = m === "Chevy" ? "Chevrolet" : m === "VW" ? "Volkswagen" : m;
      makeIndex = idx;
      break;
    }
    // Try noise-normalised text (handles "T0Y0TA" → "TOYOTA", "HYUNDA1").
    const nIdx = normalised.indexOf(normaliseOcr(m.toUpperCase()));
    if (nIdx !== -1) {
      make = m === "Chevy" ? "Chevrolet" : m === "VW" ? "Volkswagen" : m;
      // Map normalised index back to original text index (approximate).
      makeIndex = nIdx;
      break;
    }
  }

  // ── Model ─────────────────────────────────────────────────────────────────
  let model = "";
  if (makeIndex !== -1) {
    const afterMake = text.slice(makeIndex + make.length);
    // Capture up to 3 words on the same line after the make (e.g. "Grand Cherokee Laramie").
    const modelMatch = /^[\s,]*([A-Za-z0-9][\w-]*)(?:\s+([A-Za-z0-9][\w-]*))?(?:\s+([A-Za-z0-9][\w-]*))?/.exec(afterMake);
    if (modelMatch) {
      model = [modelMatch[1], modelMatch[2], modelMatch[3]].filter(Boolean).join(" ");
    }
  }

  return { year, make, model };
}

function extractVin(text: string): string {
  const VIN_CHARSET = "[A-HJ-NPR-Z0-9]";
  const VIN_RE = new RegExp(
    `(?:VIN\\s*[:#]?\\s*)?(${VIN_CHARSET}{17})(?=[^A-HJ-NPR-Z0-9]|$)`,
    "i",
  );

  // Try clean uppercase text.
  let m = VIN_RE.exec(text.toUpperCase());
  if (m) return m[1].toUpperCase();

  // OCR often confuses I↔1 and O↔0. Normalize common substitutions and retry.
  const cleaned = text.toUpperCase()
    .replace(/[IΙ]/g, "1")   // I (and Greek iota) → 1
    .replace(/O/g, "0")       // O → 0 (VINs never contain O)
    .replace(/Q/g, "0");      // Q → 0 (VINs never contain Q)
  m = VIN_RE.exec(cleaned);
  return m ? m[1].toUpperCase() : "";
}

function extractOpCodes(text: string, library: OpCode[]): string[] {
  const upper = text.toUpperCase();
  const normalised = normaliseOcr(upper);
  return library
    .filter((oc) => {
      const code = oc.code.trim().toUpperCase();
      const boundary = `(?:^|[\\s,;:()])${escapeRe(code)}(?:[\\s,;:()]|$)`;
      const re = new RegExp(boundary, "m");
      return re.test(upper) || re.test(normalised);
    })
    .map((oc) => oc.id);
}

// ── Region-based OCR helpers ─────────────────────────────────────────────────

// Extract only the field(s) relevant to a given FieldId from an OCR text string.
// Used for region crops — the crop already isolates the field, so we skip
// label-anchored patterns and go straight to the content.
export function extractFieldFromText(
  text: string,
  field: FieldId,
  library: OpCode[],
): Partial<Omit<OcrResult, "confidence">> {
  switch (field) {
    case "roNumber": return { roNumber: extractRoNumber(text) };
    case "vehicle":  return extractVehicle(text);
    case "vin":      return { vin: extractVin(text) };
    case "opCodes":  return { opCodeIds: extractOpCodes(text, library) };
  }
}

// Grayscale + contrast enhancement + upscale to a minimum dimension.
// Tesseract accuracy improves dramatically on high-contrast grayscale input
// with text height >= ~40px.
async function preprocessCrop(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);

  // Scale up small crops so the shorter side is at least 400px, capped at 4×.
  const MIN_DIM = 400;
  const MAX_SCALE = 4;
  const scale = Math.min(MAX_SCALE, Math.max(1, MIN_DIM / Math.min(bitmap.width, bitmap.height)));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // Convert to grayscale and boost contrast.
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const CONTRAST = 1.8; // 1.0 = no change; higher = more contrast
  for (let i = 0; i < d.length; i += 4) {
    // Luminance-weighted grayscale (human-perceptual weighting).
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // Linear contrast stretch around mid-gray (128).
    const enhanced = Math.min(255, Math.max(0, (gray - 128) * CONTRAST + 128));
    d[i] = d[i + 1] = d[i + 2] = enhanced;
    // Alpha channel unchanged.
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("preprocessCrop failed"))),
      "image/jpeg",
      0.95,
    ),
  );
}

// Crop one region from an image file, add padding so edge characters aren't
// clipped, then run the preprocessing pipeline before returning.
export async function cropImageRegion(
  file: File | Blob,
  region: FieldRegion,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  // Expand region by 3% on each side (relative to the region's own dimensions)
  // to avoid clipping characters that touch the drawn box edge.
  const PAD = 0.03;
  const padX = region.width * PAD;
  const padY = region.height * PAD;
  const x     = Math.max(0,   region.x - padX);
  const y     = Math.max(0,   region.y - padY);
  const right = Math.min(100, region.x + region.width  + padX);
  const bot   = Math.min(100, region.y + region.height + padY);

  const px = Math.round((x / 100) * bitmap.width);
  const py = Math.round((y / 100) * bitmap.height);
  const pw = Math.max(1, Math.round(((right - x) / 100) * bitmap.width));
  const ph = Math.max(1, Math.round(((bot   - y) / 100) * bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  canvas.getContext("2d")!.drawImage(bitmap, px, py, pw, ph, 0, 0, pw, ph);
  bitmap.close();

  const raw = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
      "image/jpeg",
      0.92,
    ),
  );

  return preprocessCrop(raw);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Swap common OCR look-alike pairs so code matching survives noise.
function normaliseOcr(upper: string): string {
  return upper
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/\bI\b/g, "1");
}
