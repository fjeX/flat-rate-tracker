"use client";

// Report-a-Bug form. Opens from the footer. The user writes what went wrong and
// optionally attaches up to MAX_BUG_PHOTOS screenshots; page URL / user agent /
// viewport are captured silently at submit time so triage can reproduce without
// a back-and-forth. Screenshots are downscaled client-side before upload.
import { useRef, useState, useTransition } from "react";
import { Camera, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StatusField } from "@/components/ui/StatusField";
import { downscaleImage } from "@/lib/image";
import { MAX_BUG_PHOTOS, MAX_BUG_DESCRIPTION_CHARS } from "@/lib/bug-reports";
import { submitBugReport } from "@/app/actions/bug-reports";
import { actionErrorMessage } from "@/lib/action-error";

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
        setError(actionErrorMessage(err, "Couldn't send the report. Try again."));
      }
    });
  }

  const atCap = photos.length >= MAX_BUG_PHOTOS;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Report a bug"
      footer={
        done ? (
          <Button variant="go" className="bug-go" onClick={handleClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="quiet" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="go"
              className="bug-go"
              onClick={handleSubmit}
              disabled={submitting}
              busy={submitting}
            >
              {submitting ? "Sending…" : "Send report"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="bug-body">
          <StatusField tag="Saved" inset>
            <p className="bug-thanks">Thanks — report sent.</p>
            <p>
              We&apos;ll take a look and get it sorted.
              {done.photosFailed > 0 &&
                ` (${done.photosFailed} screenshot${done.photosFailed > 1 ? "s" : ""} couldn't be attached.)`}
            </p>
          </StatusField>
        </div>
      ) : (
        <div className="bug-body">
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

          <section className="bug-shots">
            <p className="field-label">
              Screenshots <span className="bug-opt">(optional, up to {MAX_BUG_PHOTOS})</span>
            </p>
            {photos.length > 0 && (
              <div className="bug-grid">
                {photos.map((p, i) => (
                  <div key={p.id} className="card-inset bug-tile">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt={`Screenshot ${i + 1} preview`} className="bug-thumb" />
                    <Button
                      variant="quiet"
                      className="bug-remove"
                      onClick={() => removePhoto(p.id)}
                      disabled={submitting}
                      aria-label={`Remove screenshot ${i + 1}`}
                    >
                      <X size={16} aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {!atCap && (
              <div>
                <Button
                  variant="line"
                  onClick={() => fileRef.current?.click()}
                  disabled={submitting}
                  aria-label="Add a screenshot"
                >
                  <Camera size={16} aria-hidden="true" />
                  Add a screenshot
                </Button>
              </div>
            )}
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
          </section>

          {error && (
            <StatusField tag="Fix" role="alert" inset>
              {error}
            </StatusField>
          )}
        </div>
      )}
    </Modal>
  );
}
