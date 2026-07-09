"use client";

// Evidence Locker UI for one RO: a thumbnail strip of attached photos that opens
// a full-screen viewer, plus an attach control. Authenticated-only — guest mode
// uses GuestRoDetailModal, which renders no photo UI at all.
//
// Signed URLs are minted on open (never persisted) so links can't leak across
// sessions; thumbnails are lazy-loaded.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Camera, Loader2, Trash2, X } from "lucide-react";
import type { EntryPhoto } from "@/lib/types";
import { downscaleImage } from "@/lib/image";
import { MAX_PHOTOS_PER_ENTRY } from "@/lib/photos";
import {
  deleteEntryPhoto,
  getPhotoSignedUrl,
  listEntryPhotosAction,
  uploadEntryPhoto,
} from "@/app/actions/entry-photos";

// "Photographed Jul 7, 2026 · 3:41 PM" — the immutable capture stamp.
function formatCaptured(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

export function EntryPhotos({ entryId }: { entryId: string }) {
  const [photos, setPhotos] = useState<EntryPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Mint a signed URL for one photo, on demand, and cache it in state for this
  // session only.
  const ensureUrl = useCallback(
    async (photo: EntryPhoto) => {
      try {
        const url = await getPhotoSignedUrl(photo.storagePath);
        setUrls((prev) => ({ ...prev, [photo.id]: url }));
      } catch {
        // Thumbnail just won't render; not fatal.
      }
    },
    [],
  );

  // Load the photo list on open, then sign each URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listEntryPhotosAction(entryId);
        if (cancelled) return;
        setPhotos(list);
        await Promise.all(list.map(ensureUrl));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load photos.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId, ensureUrl]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    startUpload(async () => {
      try {
        const compressed = await downscaleImage(file);
        const fd = new FormData();
        fd.append("photo", compressed, "ro.jpg");
        const created = await uploadEntryPhoto(entryId, fd);
        setPhotos((prev) => [...prev, created]);
        await ensureUrl(created);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't attach photo.");
      }
    });
  }

  async function handleDelete(photoId: string) {
    if (!window.confirm("Delete this photo? This can't be undone.")) return;
    setError(null);
    try {
      await deleteEntryPhoto(photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setUrls((prev) => {
        const next = { ...prev };
        delete next[photoId];
        return next;
      });
      setViewerId((id) => (id === photoId ? null : id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete photo.");
    }
  }

  const atCap = photos.length >= MAX_PHOTOS_PER_ENTRY;
  const viewerPhoto = viewerId ? photos.find((p) => p.id === viewerId) ?? null : null;

  return (
    <div className="card-inset p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-[var(--fg-3)]">
        <Camera className="h-3.5 w-3.5" />
        Photos
        {photos.length > 0 && <span className="text-[var(--fg-2)]">({photos.length})</span>}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-[var(--fg-3)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setViewerId(photo.id)}
              aria-label={`View photo captured ${formatCaptured(photo.capturedAt)}`}
              className="relative h-16 w-16 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-3)] transition-colors hover:border-[var(--brand-soft)]"
            >
              {urls[photo.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urls[photo.id]}
                  alt={`RO photo captured ${formatCaptured(photo.capturedAt)}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="grid h-full w-full place-items-center text-[var(--fg-3)]">
                  <Camera className="h-4 w-4" />
                </span>
              )}
            </button>
          ))}

          {!atCap && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="grid h-16 w-16 place-items-center rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] text-[var(--fg-3)] hover:border-[var(--brand-soft)] hover:text-[var(--fg-1)] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Attach a photo"
            >
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            </button>
          )}
        </div>
      )}

      {!loading && photos.length === 0 && !uploading && (
        <p className="mt-1 text-xs text-[var(--fg-3)]">
          No photos yet. Attach the RO ticket as a timestamped record.
        </p>
      )}
      {atCap && (
        <p className="mt-2 text-xs text-[var(--fg-3)]">
          Maximum {MAX_PHOTOS_PER_ENTRY} photos per RO.
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[var(--bad)]">{error}</p>}

      <label htmlFor={`photo-input-${entryId}`} className="sr-only">
        Attach a photo
      </label>
      <input
        ref={fileRef}
        id={`photo-input-${entryId}`}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      {viewerPhoto && (
        <PhotoViewer
          url={urls[viewerPhoto.id]}
          capturedAt={viewerPhoto.capturedAt}
          onClose={() => setViewerId(null)}
          onDelete={() => handleDelete(viewerPhoto.id)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------

function PhotoViewer({
  url,
  capturedAt,
  onClose,
  onDelete,
}: {
  url: string | undefined;
  capturedAt: string;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const [deleting, startDelete] = useTransition();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-[60] flex flex-col bg-[var(--overlay-scrim)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <div className="text-xs text-[var(--overlay-fg)]/50">Photographed</div>
          <div className="truncate text-sm font-medium text-[var(--overlay-fg)]">{formatCaptured(capturedAt)}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="grid h-11 w-11 place-items-center rounded-full text-[var(--overlay-fg)]/80 hover:bg-[var(--overlay-fg)]/10 hover:text-[var(--overlay-fg)]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`RO photo captured ${formatCaptured(capturedAt)}`}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-[var(--overlay-fg)]/60" />
        )}
      </div>

      <div className="flex items-center justify-center px-4 py-3">
        <button
          type="button"
          onClick={() => startDelete(async () => { await onDelete(); })}
          disabled={deleting}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--overlay-fg)]/20 px-4 py-2 text-sm text-[var(--overlay-fg)]/90 hover:bg-[var(--overlay-fg)]/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting…" : "Delete photo"}
        </button>
      </div>
    </div>
  );
}
