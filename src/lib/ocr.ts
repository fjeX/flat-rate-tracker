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
  const upper = text.toUpperCase();
  const normalised = normaliseOcr(upper);

  // ── Make ──────────────────────────────────────────────────────────────────
  let make = "";
  let makeIndex = -1;

  for (const m of KNOWN_MAKES) {
    const idx = upper.indexOf(m.toUpperCase());
    if (idx !== -1) {
      make = m === "Chevy" ? "Chevrolet" : m === "VW" ? "Volkswagen" : m;
      makeIndex = idx;
      break;
    }
    const nIdx = normalised.indexOf(normaliseOcr(m.toUpperCase()));
    if (nIdx !== -1) {
      make = m === "Chevy" ? "Chevrolet" : m === "VW" ? "Volkswagen" : m;
      makeIndex = nIdx;
      break;
    }
  }

  // ── Year ──────────────────────────────────────────────────────────────────
  // Try 4-digit year first (1900–2099).
  let year = match1(text, /\b((?:19|20)\d{2})\b/);

  if (!year && makeIndex !== -1) {
    // Many shops print 2-digit years ("18 TOYOTA" instead of "2018 TOYOTA").
    // Look on the same line as the make, in the text before the make name.
    const lineStart = text.lastIndexOf("\n", makeIndex) + 1;
    const beforeMake = text.slice(lineStart, makeIndex);
    const m2 = /\b'?(\d{2})\b/.exec(beforeMake);
    if (m2) {
      const yy = parseInt(m2[1], 10);
      // 00–29 → 20XX (2000–2029), 30–99 → 19XX (1930–1999)
      year = `${yy <= 29 ? "20" : "19"}${m2[1].padStart(2, "0")}`;
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
  const VIN_RE = new RegExp(`(${VIN_CHARSET}{17})`);

  const upper = text.toUpperCase();

  // Pass 1: clean text, exact match.
  let m = VIN_RE.exec(upper);
  if (m) return m[1];

  // Pass 2: strip whitespace — Tesseract frequently inserts a space mid-VIN
  // (observed between characters 9 and 10 on real printed ROs).
  const spaceless = upper.replace(/\s+/g, "");
  m = VIN_RE.exec(spaceless);
  if (m) return m[1];

  // Pass 3: strip whitespace + apply I/O/Q noise corrections.
  const cleaned = spaceless
    .replace(/[IΙ]/g, "1")   // I (and Greek iota) → 1
    .replace(/O/g, "0")       // O → 0 (VINs never contain O)
    .replace(/Q/g, "0");      // Q → 0 (VINs never contain Q)
  m = VIN_RE.exec(cleaned);
  return m ? m[1] : "";
}

// Minimum edit distance between two strings (insertions, deletions, substitutions).
// Used for fuzzy op code matching — catches single-character OCR errors.
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function extractOpCodes(text: string, library: OpCode[]): string[] {
  const upper = text.toUpperCase();
  const normalised = normaliseOcr(upper);

  // Pre-split OCR text into words for fuzzy pass — deduplicated for efficiency.
  const words = [...new Set([
    ...upper.split(/[\s,;:()\n]+/),
    ...normalised.split(/[\s,;:()\n]+/),
  ])].filter((w) => w.length >= 3);

  return library
    .filter((oc) => {
      const code = oc.code.trim().toUpperCase();
      const normCode = normaliseOcr(code);

      // Pass 1: exact boundary match (fast path).
      const boundary = `(?:^|[\\s,;:()])${escapeRe(code)}(?:[\\s,;:()]|$)`;
      const re = new RegExp(boundary, "m");
      if (re.test(upper) || re.test(normalised)) return true;

      // Pass 2: fuzzy match — edit distance ≤ 1 for codes of 4+ chars.
      // Catches single-character OCR substitutions (e.g. RUTATE → ROTATE).
      if (code.length >= 4) {
        for (const word of words) {
          if (Math.abs(word.length - normCode.length) <= 1 && levenshtein(word, normCode) <= 1) {
            return true;
          }
        }
      }

      return false;
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

// Swap common OCR look-alike pairs so matching survives noise.
// Applied symmetrically to both OCR text and library codes before comparison,
// so both sides are on equal footing.
function normaliseOcr(upper: string): string {
  return upper
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/5/g, "S")   // 5 ↔ S are frequently confused
    .replace(/8/g, "B")   // 8 ↔ B are frequently confused
    .replace(/\bI\b/g, "1");
}
