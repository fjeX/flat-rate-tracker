import { describe, expect, it } from "vitest";
import { envelopeTarget, parseDsn } from "./tunnel";

const OWN = "https://abc123@o451.ingest.us.sentry.io/4512";
const enc = (s: string) => new TextEncoder().encode(s);
const envelope = (dsn: unknown) =>
  enc(`${JSON.stringify({ event_id: "e1", dsn })}\n{"type":"event"}\n{"message":"boom"}`);

describe("parseDsn", () => {
  it("reads host and numeric project id", () => {
    expect(parseDsn(OWN)).toEqual({ host: "o451.ingest.us.sentry.io", projectId: "4512" });
  });
  it.each([undefined, "", "not a url", "http://k@o1.ingest.sentry.io/1", "https://o1.ingest.sentry.io/1", "https://k@o1.ingest.sentry.io/abc"])(
    "rejects %s",
    (dsn) => expect(parseDsn(dsn as string | undefined)).toBeNull(),
  );
});

describe("envelopeTarget", () => {
  it("forwards an envelope addressed to our project", () => {
    expect(envelopeTarget(envelope(OWN), OWN)).toBe("https://o451.ingest.us.sentry.io/api/4512/envelope/");
  });

  it("refuses to relay to another project or host (no open relay)", () => {
    expect(envelopeTarget(envelope("https://abc123@o451.ingest.us.sentry.io/9999"), OWN)).toBeNull();
    expect(envelopeTarget(envelope("https://abc123@evil.example.com/4512"), OWN)).toBeNull();
  });

  it("refuses garbage and missing DSNs", () => {
    expect(envelopeTarget(enc("not json\n{}"), OWN)).toBeNull();
    expect(envelopeTarget(envelope(undefined), OWN)).toBeNull();
    expect(envelopeTarget(envelope(42), OWN)).toBeNull();
  });

  it("forwards nothing when the app has no DSN configured", () => {
    expect(envelopeTarget(envelope(OWN), undefined)).toBeNull();
  });
});
