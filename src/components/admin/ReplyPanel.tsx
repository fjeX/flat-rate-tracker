"use client";

// Reply-to-submitter panel inside both admin detail modals (BugInbox,
// FeatureInbox). Shows replies already sent (and whether they've been seen),
// then a box to send another. When the SAVED status is Resolved (bug) or
// Shipped (request), "Write a thank-you" drops in an editable starter message,
// and the reply goes out as a "your bug got fixed" / "your idea made it in"
// notice instead of a plain note. Status changes must be saved first — the
// server decides the kind from the saved row, not from this form.
import { useState, useTransition } from "react";
import type { SubmissionReply, Submitter } from "@/lib/types";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatusField } from "@/components/ui/StatusField";
import { MAX_REPLY_CHARS, replyKindFor, thankYouTemplate } from "@/lib/feature-requests";
import { sendSubmissionReply } from "@/app/actions/submission-replies";
import { actionErrorMessage } from "@/lib/action-error";

export function submitterName(s: Submitter | undefined): string {
  if (!s) return "Unknown user";
  const name = [s.firstName, s.lastName].filter(Boolean).join(" ");
  return name || s.email || "Unknown user";
}

const KIND_LABEL = { fixed: "Fixed thank-you", shipped: "Shipped thank-you", note: "Note" } as const;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ReplyPanel({
  source,
  submissionId,
  savedStatus,
  submitter,
  replies,
  onSent,
}: {
  source: "bug" | "feature";
  submissionId: string;
  savedStatus: string;
  submitter: Submitter | undefined;
  replies: SubmissionReply[];
  onSent: (reply: SubmissionReply) => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();

  const kind = replyKindFor(source, savedStatus);
  const template = thankYouTemplate(kind, submitter?.firstName ?? null);
  const name = submitterName(submitter);
  const target = source === "bug" ? "Resolved" : "Shipped";

  function handleSend() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Write a message before sending.");
      return;
    }
    setError(null);
    startSend(async () => {
      try {
        const reply = await sendSubmissionReply(source, submissionId, trimmed);
        setMessage("");
        onSent(reply);
      } catch (err) {
        setError(actionErrorMessage(err, "Couldn't send the reply. Try again."));
      }
    });
  }

  return (
    <section className="rn-panel">
      <div className="field-label">Reply to {name}</div>

      {replies.length > 0 && (
        <div className="rn-hist">
          {replies.map((r) => (
            <div key={r.id} className="card-inset rn-sent">
              <p>{r.message}</p>
              <span className="rn-sent-meta">
                <Badge tone={r.kind === "note" ? "neutral" : "good"}>{KIND_LABEL[r.kind]}</Badge>
                <span>Sent {formatWhen(r.createdAt)}</span>
                <span>{r.seenAt ? `Seen ${formatWhen(r.seenAt)}` : "Not seen yet"}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <Field
        label={kind === "note" ? "Message" : `${KIND_LABEL[kind]} message`}
        htmlFor={`reply-${submissionId}`}
        hint={`Pops up in the middle of ${name === "Unknown user" ? "their" : `${name}'s`} screen next time they open the app.`}
      >
        <Textarea
          id={`reply-${submissionId}`}
          rows={4}
          maxLength={MAX_REPLY_CHARS}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={sending}
        />
      </Field>

      {kind === "note" && (
        <p className="rn-hint">
          Save the status as <b>{target}</b> first to send this as a thank-you instead of a note.
        </p>
      )}

      <div className="rn-actions">
        {template && (
          <Button variant="line" onClick={() => setMessage(template)} disabled={sending}>
            Write a thank-you
          </Button>
        )}
        <Button
          variant="go"
          className="rn-send"
          onClick={handleSend}
          disabled={sending || !message.trim()}
          busy={sending}
        >
          {sending ? "Sending…" : "Send reply"}
        </Button>
      </div>

      {error && (
        <StatusField tag="Fix" role="alert" inset>
          {error}
        </StatusField>
      )}
    </section>
  );
}
