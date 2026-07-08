// VIN validation + decode against NHTSA's free vPIC API.
//
// Two jobs:
//   1. isValidVin  — cheap client-side gate so we only hit the network for VINs
//      that could plausibly decode. Enforces the 17-char / no-I-O-Q rules and
//      the ISO 3779 check digit (position 9). The check digit is what catches an
//      OCR misread — a single wrong character almost always fails it.
//   2. decodeVin   — one GET to vPIC's DecodeVinValues, mapped down to the few
//      fields the form cares about. Silent-degrades to null on any failure so the
//      form behaves exactly as it does today when offline / the API is down.
//
// No API key, no signup, no cost. Pre-1981 vehicles have non-17-char VINs — the
// validator just declines them (returns false); it never throws.

export type VinDecodeResult = {
  year: string;
  make: string;
  model: string;
  // Display-only extras — not persisted in v1 (no schema change).
  engine: string;
  trim: string;
  // True when vPIC returned data but flagged warnings (partial decode).
  partial: boolean;
  warning?: string;
};

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";
const DECODE_TIMEOUT_MS = 5000;

// VINs never use I, O, or Q (too easy to confuse with 1 and 0).
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

// Check-digit transliteration: each letter maps to a number. I/O/Q are absent by
// design — they can't appear in a valid VIN.
const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

// Positional weights (position 9, index 8, is the check digit itself → weight 0).
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// Makes that read wrong when naively title-cased (BMW → "Bmw"). Kept uppercase.
const ACRONYM_MAKES = new Set(["BMW", "GMC", "RAM", "MINI", "MG"]);

/**
 * True only for a structurally valid 17-char VIN with a correct check digit.
 * Non-17-char VINs (e.g. pre-1981) and illegal characters return false — never
 * throws. Input is upper-cased and trimmed first.
 */
export function isValidVin(vin: string): boolean {
  const v = vin.trim().toUpperCase();
  if (!VIN_RE.test(v)) return false;

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = v[i];
    const value = ch >= "0" && ch <= "9" ? Number(ch) : TRANSLITERATION[ch];
    // VIN_RE already excluded I/O/Q, so every char maps — but guard anyway.
    if (value === undefined) return false;
    sum += value * WEIGHTS[i];
  }

  const remainder = sum % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  return v[8] === expected;
}

// Shape of the single row vPIC returns from DecodeVinValues.
type VpicRow = {
  ModelYear?: string;
  Make?: string;
  Model?: string;
  EngineCylinders?: string;
  DisplacementL?: string;
  Trim?: string;
  ErrorCode?: string;
  ErrorText?: string;
};

type VpicResponse = { Results?: VpicRow[] };

function clean(value: string | undefined | null): string {
  return (value ?? "").trim();
}

// vPIC returns makes in ALL CAPS ("TOYOTA", "MERCEDES-BENZ"). Title-case each
// word for display, but keep known acronyms (BMW, GMC…) uppercase.
function titleCaseMake(raw: string): string {
  return raw
    .toLowerCase()
    .split(/([\s-])/) // keep spaces and hyphens as delimiters
    .map((part) => {
      if (part === " " || part === "-" || part === "") return part;
      if (ACRONYM_MAKES.has(part.toUpperCase())) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

// Assemble a human "2.5L 4-cyl" style engine string from the pieces vPIC gives.
function buildEngine(row: VpicRow): string {
  const liters = clean(row.DisplacementL);
  const cyl = clean(row.EngineCylinders);
  const parts: string[] = [];
  if (liters) parts.push(`${Number(liters).toFixed(1)}L`);
  if (cyl) parts.push(`${cyl}-cyl`);
  return parts.join(" ");
}

/**
 * Map a raw vPIC response down to the fields the form uses. Exported for tests.
 * Accepts partial results (vPIC returns warning ErrorCodes alongside real data);
 * returns null only on total failure — no row, or no usable year/make/model.
 */
export function mapVpicResponse(data: unknown): VinDecodeResult | null {
  const row = (data as VpicResponse | null | undefined)?.Results?.[0];
  if (!row) return null;

  const year = clean(row.ModelYear);
  const rawMake = clean(row.Make);
  const make = rawMake ? titleCaseMake(rawMake) : "";
  const model = clean(row.Model);

  // Nothing usable came back — treat as a failed decode.
  if (!year && !make && !model) return null;

  const errorCode = clean(row.ErrorCode);
  const partial = errorCode !== "" && errorCode !== "0";

  return {
    year,
    make,
    model,
    engine: buildEngine(row),
    trim: clean(row.Trim),
    partial,
    warning: partial ? clean(row.ErrorText) || undefined : undefined,
  };
}

/**
 * Decode a VIN via vPIC. Returns the mapped result, or null on any failure
 * (invalid VIN, offline, timeout, non-2xx, bad JSON, empty decode). Never
 * throws — callers can await it without a try/catch and the form silent-degrades.
 * 5s timeout with abort so a slow government API never blocks the UI.
 */
export async function decodeVin(vin: string): Promise<VinDecodeResult | null> {
  const v = vin.trim().toUpperCase();
  if (!isValidVin(v)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DECODE_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${VPIC_BASE}/${encodeURIComponent(v)}?format=json`,
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return mapVpicResponse(data);
  } catch {
    // Offline, aborted (timeout), or malformed response — degrade silently.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
