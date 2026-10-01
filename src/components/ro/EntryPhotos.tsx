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
import { actionErrorMessage } from "@/lib/action-error";
import { StatusField } from "@/components/ui/StatusField";

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
        if (!cancelled) setError(actionErrorMessage(e, "Couldn't load photos."));
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
        setError(actionErrorMessage(err, "Couldn't attach photo."));
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
      setError(actionErrorMessage(err, "Couldn't delete photo."));
    }
  }

  const atCap = photos.length >= MAX_PHOTOS_PER_ENTRY;
  const viewerPhoto = viewerId ? photos.find((p) => p.id === viewerId) ?? null : null;

  return (
    <div className="card-inset rod-well">
      <div className="rod-well-head">
        <h3 className="field-label rod-well-name">
          <Camera className="h-4 w-4" aria-hidden="true" />
          Photos
          {photos.length > 0 && <span className="rod-count">({photos.length})</span>}
        </h3>
      </div>

      {loading ? (
        <div className="rod-loading">
          <Loader2 className="h-4 w-4 rod-spin" />
          Loading…
        </div>
      ) : (
        <div className="rod-thumbs">
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setViewerId(photo.id)}
              aria-label={`View photo captured ${formatCaptured(photo.capturedAt)}`}
              className="rod-thumb"
            >
              {urls[photo.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urls[photo.id]}
                  alt={`RO photo captured ${formatCaptured(photo.capturedAt)}`}
                  loading="lazy"
                />
              ) : (
                <Camera className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          ))}

          {!atCap && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rod-thumb is-add"
              aria-label="Attach a photo"
            >
              {uploading ? <Loader2 className="h-5 w-5 rod-spin" /> : <Camera className="h-5 w-5" />}
            </button>
          )}
        </div>
      )}

      {!loading && photos.length === 0 && !uploading && (
        <p className="rod-fine-p">
          No photos yet. Attach the RO ticket as a timestamped record.
        </p>
      )}
      {atCap && (
        <p className="rod-fine-p">
          Maximum {MAX_PHOTOS_PER_ENTRY} photos per RO.
        </p>
      )}
      {error && (
        <StatusField tag="Fix" role="alert" inset>
          <p>{error}</p>
        </StatusField>
      )}

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
      className="rod-viewer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rod-viewer-head">
        <div className="min-w-0">
          <div className="rod-viewer-k">Photographed</div>
          <div className="rod-viewer-v">{formatCaptured(capturedAt)}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="rod-viewer-x"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="rod-viewer-stage">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`RO photo captured ${formatCaptured(capturedAt)}`}
          />
        ) : (
          <Loader2 className="h-6 w-6 rod-spin" aria-hidden="true" />
        )}
      </div>

      <div className="rod-viewer-foot">
        <button
          type="button"
          onClick={() => startDelete(async () => { await onDelete(); })}
          disabled={deleting}
          className="rod-viewer-del"
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting…" : "Delete photo"}
        </button>
      </div>
    </div>
  );
}
