// Shared client-side image downscaler. Shrinks a captured photo so the long edge
// is at most `maxEdge` px and re-encodes as JPEG before upload — keeps stored RO
// photos small (~1.5 MB target) without shipping the full-resolution camera file.
//
// Shaped so PLAN-ocr-claude-vision can reuse it: the sizing math is pulled out
// into `fitLongEdge` (pure, unit-tested) and the canvas work is a thin wrapper.

export type Dimensions = { width: number; height: number };

// Constrain `{width, height}` so its LONG edge is <= maxEdge, preserving aspect
// ratio. Returns the input unchanged when it already fits (never upscales).
// Pure function — no DOM, no canvas — so it's unit-testable in isolation.
export function fitLongEdge(
  width: number,
  height: number,
  maxEdge: number,
): Dimensions {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge || longEdge === 0) {
    return { width, height };
  }
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type DownscaleOptions = {
  maxEdge?: number; // long-edge ceiling in px (default 2000)
  quality?: number; // JPEG quality 0..1 (default 0.8)
};

// Downscale an image File/Blob and return a JPEG Blob. Runs on the client only
// (uses createImageBitmap + canvas). Falls back to the original blob dimensions
// if it already fits under maxEdge.
export async function downscaleImage(
  file: File | Blob,
  { maxEdge = 2000, quality = 0.8 }: DownscaleOptions = {},
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitLongEdge(bitmap.width, bitmap.height, maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas 2D context unavailable.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image downscale failed."))),
      "image/jpeg",
      quality,
    ),
  );
}
