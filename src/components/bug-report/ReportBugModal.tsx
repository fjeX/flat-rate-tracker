"use client";

// Report-a-Bug form. Opens from the footer. The user writes what went wrong and
// optionally attaches up to MAX_BUG_PHOTOS screenshots; page URL / user agent /
// viewport are captured silently at submit time so triage can reproduce without
// a back-and-forth. Screenshots are downscaled client-side before upload.
import { useRef, useState, useTransition } from "react";
import { Camera, Loader2, X, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { downscaleImage } from "@/lib/image";
import { MAX_BUG_PHOTOS, MAX_BUG_DESCRIPTION_CHARS } from "@/lib/bug-reports";
import { submitBugReport } from "@/app/actions/bug-reports";

type Attachment = { id: string; file: File; previewUrl: string };

export function ReportBugModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ photosFailed: number } | null>(null);
  const [submitting, startSubmit] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setDescription("");
    setPhotos([]);
    setError(null);
    setDone(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (chosen.length === 0) return;
    setError(null);
    const room = MAX_BUG_PHOTOS - photos.length;
    if (room <= 0) return;
    const next = chosen.slice(0, room).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...next]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function handleSubmit() {
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Please describe the bug before sending.");
      return;
    }
    setError(null);
    startSubmit(async () => {
      try {
        const fd = new FormData();
        fd.append("description", trimmed);
        fd.append("page_url", window.location.href);
        fd.append("user_agent", navigator.userAgent);
        fd.append("viewport", `${window.innerWidth}×${window.innerHeight}`);
        for (const p of photos) {
          const compressed = await downscaleImage(p.file, { maxEdge: 2400, quality: 0.85 });
          fd.append("photo", compressed, "screenshot.jpg");
        }
        const result = await submitBugReport(fd);
        photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        setPhotos([]);
        setDescription("");
        setDone({ photosFailed: result.photosFailed });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't send the report. Try again.");
      }
    });
  }

  const atCap = photos.length >= MAX_BUG_PHOTOS;

  return (
    <Modal open={open} onClose={handleClose} title="Report a bug">
      {done ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-[var(--good)]" />
          <div>
            <p className="text-base font-semibold text-[var(--fg-0)]">Thanks — report sent.</p>
            <p className="mt-1 text-sm text-[var(--fg-2)]">
              We&apos;ll take a look and get it sorted.
              {done.photosFailed > 0 &&
                ` (${done.photosFailed} screenshot${done.photosFailed > 1 ? "s" : ""} couldn't be attached.)`}
            </p>
          </div>
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field
            label="What went wrong?"
            htmlFor="bug-description"
            hint="Describe the issue in as much detail as you can — what you did, what you expected, and what actually happened."
          >
            <Textarea
              id="bug-description"
              rows={5}
              maxLength={MAX_BUG_DESCRIPTION_CHARS}
              placeholder="e.g. I tapped Save on a repair order and the hours reset to zero…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
            />
          </Field>

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--fg-3)]">
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              Screenshots
              <span className="text-[var(--fg-3)] normal-case tracking-normal">
                (optional, up to {MAX_BUG_PHOTOS})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div
                  key={p.id}
                  className="relative h-16 w-16 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-3)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.previewUrl}
                    alt={`Screenshot ${i + 1} preview`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(p.id)}
                    disabled={submitting}
                    aria-label={`Remove screenshot ${i + 1}`}
                    className="absolute right-0.5 top-0.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
              {!atCap && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={submitting}
                  className="grid h-16 w-16 place-items-center rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] text-[var(--fg-3)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Add a screenshot"
                >
                  <Camera className="h-5 w-5" />
                </button>
              )}
            </div>
            <label htmlFor="bug-photo-input" className="sr-only">
              Add screenshots
            </label>
            <input
              ref={fileRef}
              id="bug-photo-input"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFiles}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-[var(--bad)]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send report"
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
