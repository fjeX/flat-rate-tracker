"use client";

// Request-a-Feature form. Opens from the footer (next to Report a Bug) and from
// the About page. One text box; the page URL is captured silently so the inbox
// shows where the idea came from. Reuses the bug dialog's body styles
// (dlg-bug-report.css) — same shape, minus screenshots.
import { useEffect, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StatusField } from "@/components/ui/StatusField";
import { MAX_FEATURE_DESCRIPTION_CHARS } from "@/lib/feature-requests";
import { submitFeatureRequest } from "@/app/actions/feature-requests";
import { actionErrorMessage } from "@/lib/action-error";

export function RequestFeatureModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const doneRef = useRef<HTMLDivElement>(null);

  // The Send button unmounts on success, which would drop focus to <body>.
  useEffect(() => {
    if (done) doneRef.current?.closest<HTMLElement>("[role=dialog]")?.querySelector<HTMLButtonElement>(".bug-go")?.focus();
  }, [done]);

  function handleClose() {
    if (submitting) return;
    setDescription("");
    setError(null);
    setDone(false);
    onClose();
  }

  function handleSubmit() {
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Tell us what you'd like before sending.");
      return;
    }
    setError(null);
    startSubmit(async () => {
      try {
        const fd = new FormData();
        fd.append("description", trimmed);
        fd.append("page_url", window.location.href);
        await submitFeatureRequest(fd);
        setDescription("");
        setDone(true);
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't send the request. Try again."));
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Request a feature"
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
              {submitting ? "Sending…" : "Send request"}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div ref={doneRef} className="bug-body">
          <StatusField tag="Saved" role="status" inset>
            <p className="bug-thanks">Thanks — request sent.</p>
            <p>Every request gets read. The ones that would help the most techs move up the list.</p>
          </StatusField>
        </div>
      ) : (
        <div className="bug-body">
          <p className="bug-intro">
            Almost everything in here started as something I needed on a real
            day at work. If it&apos;s in the app, it&apos;s because a tech
            needed it, and that tech can be you. The app keeps changing to fit
            how techs actually work, so tell me what you wish it did, or what
            would work better another way.
          </p>
          <Field
            label="What would make the app better?"
            htmlFor="feature-description"
            hint="Say what you want and what it would save you on a real day: the job, the screen, the step it would cut."
          >
            <Textarea
              id="feature-description"
              rows={5}
              maxLength={MAX_FEATURE_DESCRIPTION_CHARS}
              placeholder="e.g. Let me copy an RO I already logged so I don't have to re-add the same op codes…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
            />
          </Field>

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
