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
  const upper = text.toUpperCase();

  // ── RO number ────────────────────────────────────────────────────────────
  // Matches: "RO# 123456", "RO 123456", "Repair Order: 123456", "WO# 12345"
  const roNumber =
    match1(text, /(?:RO\s*#?|Repair\s+Order\s*[:#]?|Work\s+Order\s*[:#]?|WO\s*#?)\s*(\d{4,8})/i) ||
    match1(text, /(?:^|\s)#(\d{4,8})(?:\s|$)/m);

  // ── Vehicle year ──────────────────────────────────────────────────────────
  // Four-digit year in 1980–2030, allowing OCR noise like "2O22" → "2022".
  const yearMatch = /\b((?:1|2)(?:9|0)\d{2})\b/.exec(text);
  const year = yearMatch?.[1] ?? "";

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
  }

  // ── Model ─────────────────────────────────────────────────────────────────
  // Grab the word(s) that immediately follow the make on the same line.
  let model = "";
  if (makeIndex !== -1) {
    const afterMake = text.slice(makeIndex + make.length);
    // Take up to 3 words on the same line after the make.
    const modelMatch = /^[\s,]*([A-Za-z0-9][\w-]*)(?:\s+([A-Za-z0-9][\w-]*))?/.exec(afterMake);
    if (modelMatch) {
      model = [modelMatch[1], modelMatch[2]].filter(Boolean).join(" ");
    }
  }

  // ── Op codes ──────────────────────────────────────────────────────────────
  // Match library codes against both the raw OCR text and a noise-normalised
  // variant so common OCR confusions (0↔O, 1↔I/L) don't cause misses.
  const normalised = normaliseOcr(upper);
  const opCodeIds = library
    .filter((oc) => {
      const code = oc.code.trim().toUpperCase();
      const boundary = `(?:^|[\\s,;:()])${escapeRe(code)}(?:[\\s,;:()]|$)`;
      const re = new RegExp(boundary, "m");
      return re.test(upper) || re.test(normalised);
    })
    .map((oc) => oc.id);

  // ── VIN ───────────────────────────────────────────────────────────────────
  // VINs are exactly 17 chars of [A-HJ-NPR-Z0-9] (I, O, Q are excluded by
  // the standard). Look for the label first; fall back to bare pattern scan.
  const VIN_CHARSET = "[A-HJ-NPR-Z0-9]";
  const VIN_RE = new RegExp(
    `(?:VIN\\s*[:#]?\\s*)?(${VIN_CHARSET}{17})(?=[^A-HJ-NPR-Z0-9]|$)`,
    "i",
  );
  const vinMatch = VIN_RE.exec(upper);
  const vin = vinMatch ? vinMatch[1].toUpperCase() : "";

  const fieldsFound = [roNumber, year, make, model].filter(Boolean).length;
  const confidence: "high" | "low" = fieldsFound >= 3 ? "high" : "low";

  return { roNumber, year, make, model, vin, opCodeIds, confidence };
}

// ── Region-based OCR helpers ─────────────────────────────────────────────────
// Used by ScanRoButton when the user has configured an RO template.
// Each region is cropped from the photo using canvas so Tesseract only sees
// the relevant portion — far less noise, much better accuracy.

// Crop one region from an image file using an offscreen canvas.
// `region` coordinates are percentages (0–100) of the image's natural dimensions.
export async function cropImageRegion(
  file: File | Blob,
  region: FieldRegion,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const px = Math.round((region.x / 100) * bitmap.width);
  const py = Math.round((region.y / 100) * bitmap.height);
  const pw = Math.max(1, Math.round((region.width / 100) * bitmap.width));
  const ph = Math.max(1, Math.round((region.height / 100) * bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  canvas.getContext("2d")!.drawImage(bitmap, px, py, pw, ph, 0, 0, pw, ph);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
      "image/jpeg",
      0.92,
    ),
  );
}

// Extract only the field(s) relevant to a given FieldId from an OCR text string.
export function extractFieldFromText(
  text: string,
  field: FieldId,
  library: OpCode[],
): Partial<Omit<OcrResult, "confidence">> {
  const full = parseOcrText(text, library);
  switch (field) {
    case "roNumber": return { roNumber: full.roNumber };
    case "vehicle":  return { year: full.year, make: full.make, model: full.model };
    case "vin":      return { vin: full.vin };
    case "opCodes":  return { opCodeIds: full.opCodeIds };
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Swap common OCR look-alike pairs so code matching survives noise.
// We produce variants: one where 0→O and one where O→0, etc.
function normaliseOcr(upper: string): string {
  return upper
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/\bI\b/g, "1");
}
