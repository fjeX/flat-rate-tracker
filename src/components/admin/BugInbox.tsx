"use client";

// Admin bug inbox. A filterable list of reports; click one to open a detail modal
// with the full description, the silently-captured context, the screenshots, and
// the triage controls. No hard delete — disposal is via the Resolved / Won't Fix
// statuses, so the history stays intact.
import { useMemo, useRef, useState, useEffect, useTransition } from "react";
import { Loader2, ImageIcon, X } from "lucide-react";
import type { BugReport } from "@/lib/types";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Zone } from "@/components/ui/Zone";
import { StatusField } from "@/components/ui/StatusField";
import { EmptyState } from "@/components/ui/EmptyState";
import { BUG_SEVERITIES, BUG_CATEGORIES, BUG_STATUSES } from "@/lib/bug-reports";
import { listBugPhotosWithUrls, setBugTriage } from "@/app/actions/bug-reports";
import { actionErrorMessage } from "@/lib/action-error";

const CLOSED_STATUSES = ["Resolved", "Won't Fix"];

type BadgeTone = "neutral" | "brand" | "good" | "warn" | "bad" | "info";

function severityTone(sev: string | null): BadgeTone {
  if (sev === "Critical") return "bad";
  if (sev === "High") return "warn";
  return "neutral";
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "New":
      return "info";
    case "Verify":
    case "Needs Info":
      return "warn";
    case "Resolved":
      return "good";
    case "Won't Fix":
      return "neutral";
    default:
      return "brand"; // Triaged, Investigating, Fix Proposed
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${d.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" },
  )}`;
}

export function BugInbox({ initialReports }: { initialReports: BugReport[] }) {
  const [reports, setReports] = useState<BugReport[]>(initialReports);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return reports.filter((r) => {
      if (statusFilter === "open" && CLOSED_STATUSES.includes(r.status)) return false;
      if (statusFilter !== "open" && statusFilter !== "all" && r.status !== statusFilter)
        return false;
      if (severityFilter !== "all" && (r.severity ?? "") !== severityFilter) return false;
      return true;
    });
  }, [reports, statusFilter, severityFilter]);

  const selected = selectedId ? reports.find((r) => r.id === selectedId) ?? null : null;

  function handleSaved(updated: BugReport) {
    setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div className="adm-inbox">
      {/* Filters */}
      <div className="adm-filters">
        <Field label="Status" htmlFor="filter-status" className="adm-filter">
          <Select
            id="filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="open">Open (default)</option>
            <option value="all">All</option>
            {BUG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Severity" htmlFor="filter-severity" className="adm-filter">
          <Select
            id="filter-severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="all">All</option>
            {BUG_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="">Untriaged</option>
          </Select>
        </Field>
      </div>

      {/* List */}
      <Zone
        name="Reports"
        aside={`${filtered.length} ${filtered.length === 1 ? "report" : "reports"}`}
      >
        {filtered.length === 0 ? (
          <EmptyState title="Nothing here" description="No reports match these filters." />
        ) : (
          <div className="adm-list">
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className="rowbtn adm-row"
              >
                <span>
                  <span className="adm-title">{r.description}</span>
                  <span className="adm-meta">
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    {r.severity && <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>}
                    {r.category && <Badge tone="neutral">{r.category}</Badge>}
                    <span className="adm-date">{formatDate(r.createdAt)}</span>
                  </span>
                </span>
                <svg className="ic ic-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M5.5 7.5L12 14l6.5-6.5 1.8 1.8L12 17.6 3.7 9.3z" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </Zone>

      {selected && (
        <BugDetail
          report={selected}
          onClose={() => setSelectedId(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BugDetail({
  report,
  onClose,
  onSaved,
}: {
  report: BugReport;
  onClose: () => void;
  onSaved: (updated: BugReport) => void;
}) {
  const [severity, setSeverity] = useState(report.severity ?? "");
  const [category, setCategory] = useState(report.category ?? "");
  const [status, setStatus] = useState(report.status);
  const [notes, setNotes] = useState(report.triageNotes ?? "");
  const [photos, setPhotos] = useState<Array<{ id: string; url: string }>>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [zoom, setZoom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listBugPhotosWithUrls(report.id);
        if (!cancelled) setPhotos(list);
      } catch {
        // Non-fatal — just no thumbnails.
      } finally {
        if (!cancelled) setPhotosLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [report.id]);

  const dirty =
    severity !== (report.severity ?? "") ||
    category !== (report.category ?? "") ||
    status !== report.status ||
    notes !== (report.triageNotes ?? "");

  // Don't let a backdrop/Escape/X dismiss discard an in-flight save.
  function handleClose() {
    if (saving) return;
    onClose();
  }

  function handleSave() {
    setError(null);
    startSave(async () => {
      try {
        await setBugTriage(report.id, { severity, category, status, triageNotes: notes });
        onSaved({
          ...report,
          severity: severity || null,
          category: category || null,
          status,
          triageNotes: notes.trim() || null,
          updatedAt: new Date().toISOString(),
        });
        onClose();
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't save. Try again."));
      }
    });
  }

  return (
    <Modal
      open
      onClose={handleClose}
      title="Bug report"
      size="lg"
      footer={
        <>
          <Button variant="quiet" onClick={handleClose} disabled={saving}>
            Close
          </Button>
          <Button
            variant="go"
            className="inb-save"
            onClick={handleSave}
            disabled={saving || !dirty}
            busy={saving}
          >
            {saving ? (
              <>
                <Loader2 className="inb-spin" size={16} aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save triage"
            )}
          </Button>
        </>
      }
    >
      <div className="inb-body">
        {/* Description */}
        <section>
          <div className="field-label">Description</div>
          <div className="card-inset inb-desc">{report.description}</div>
        </section>

        {/* Screenshots */}
        <section>
          <div className="field-label inb-label-icon">
            <ImageIcon size={14} aria-hidden="true" />
            Screenshots
          </div>
          {photosLoading ? (
            <div className="inb-loading">
              <Loader2 className="inb-spin" size={14} />
              Loading…
            </div>
          ) : photos.length === 0 ? (
            <p className="inb-fine">None attached.</p>
          ) : (
            <div className="inb-thumbs">
              {photos.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setZoom(p.url)}
                  aria-label={`View screenshot ${i + 1} of ${photos.length}`}
                  className="inb-thumb"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Screenshot ${i + 1} of ${photos.length}`} />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Auto-captured context */}
        <section>
          <div className="field-label">Context</div>
          <dl className="rows inb-ctx">
            <ContextRow label="Reported" value={formatDate(report.createdAt)} />
            <ContextRow label="Page" value={report.pageUrl} mono />
            <ContextRow label="Viewport" value={report.viewport} mono />
            <ContextRow label="Build" value={report.appBuild} mono />
            <ContextRow label="Browser" value={report.userAgent} mono />
          </dl>
        </section>

        {/* Triage controls */}
        <section className="inb-triage">
          <div className="field-label">Triage</div>
          <div className="inb-triage-grid">
            <Field label="Severity" htmlFor="triage-severity">
              <Select
                id="triage-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="">—</option>
                {BUG_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category" htmlFor="triage-category">
              <Select
                id="triage-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">—</option>
                {BUG_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="triage-status">
              <Select id="triage-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {BUG_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Triage notes" htmlFor="triage-notes">
            <Textarea
              id="triage-notes"
              rows={3}
              placeholder="Repro steps, root-cause hunch, links…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </section>

        {error && (
          <StatusField tag="Fix" role="alert" inset>
            {error}
          </StatusField>
        )}
      </div>

      {zoom && <ScreenshotZoom url={zoom} onClose={() => setZoom(null)} />}
    </Modal>
  );
}

// Full-size screenshot overlay. Own Escape handler (capture-phase + stopPropagation)
// so dismissing the zoom doesn't also close the triage modal underneath it; focus
// moves to the close button on open.
function ScreenshotZoom({ url, onClose }: { url: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
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
      aria-label="Screenshot"
      className="inb-zoom"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="inb-zoom-head">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close screenshot"
          className="btn btn-quiet inb-zoom-x"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div
        className="inb-zoom-stage"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Screenshot, full size" />
      </div>
    </div>
  );
}

function ContextRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <>
      <div className="inb-ctx-row">
        <dt className="k">{label}</dt>
        <dd className={`v${mono ? " inb-mono" : ""}`}>{value || "—"}</dd>
      </div>
    </>
  );
}
