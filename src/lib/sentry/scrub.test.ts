import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubString } from "./scrub";

// The plan's "done when": a planted email / amount / token must come out
// scrubbed. Every case here is something that can realistically end up in an
// error message, breadcrumb or URL in FRT.

describe("scrubString", () => {
  it.each([
    ["Duplicate key for liem9319@aim.com", "Duplicate key for [email]"],
    ["Payout $1,234.56 did not match", "Payout [amount] did not match"],
    ["refund -$12.5 and $ 40", "refund [amount] and [amount]"],
    [
      "https://tracker.slimelab.cc/reset-password#access_token=abc.def.ghi&refresh_token=r1&type=recovery",
      "https://tracker.slimelab.cc/reset-password#access_token=[redacted]&refresh_token=[redacted]&type=recovery",
    ],
    ["/auth/callback?code=9f8e7d6c", "/auth/callback?code=[redacted]"],
    ["Authorization: Bearer abc123.def-456", "Authorization: Bearer [token]"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nature-x leaked", "jwt [token] leaked"],
    ["key sntrys_eyJpYXQiOjE3OTE1MTc2NzJ9_abcdef", "key [token]"],
    ["resend re_AbCdEfGh12345678_xyz failed", "resend [token] failed"],
  ])("redacts %s", (input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it.each([
    "Flag hours 12.5 exceed clocked 10",
    "RO 482913 not found",
    "Cannot read properties of undefined (reading 'map')",
    "/_next/static/chunks/app/(app)/dashboard/page-3f2a.js",
  ])("leaves ordinary text alone: %s", (input) => {
    expect(scrubString(input)).toBe(input);
  });
});

describe("scrubEvent", () => {
  it("keeps only the user id and strips credential-bearing request parts", () => {
    const out = scrubEvent({
      message: "Save failed for tech@shop.com on RO 55 ($310.00)",
      user: { id: "8c1e-uuid", email: "tech@shop.com", ip_address: "1.2.3.4" },
      request: {
        url: "https://tracker.slimelab.cc/dashboard?ask=line-1",
        cookies: { "sb-access-token": "eyJx" },
        data: { pay: 310 },
        headers: { "user-agent": "Mozilla/5.0", cookie: "sb=eyJ", authorization: "Bearer x" },
      },
      exception: {
        values: [{ type: "Error", value: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcde in body" }],
      },
      breadcrumbs: [{ category: "console", message: "user tech@shop.com clicked" }],
      extra: { nested: { deeper: ["paid $99"] } },
    });

    expect(out.message).toBe("Save failed for [email] on RO 55 ([amount])");
    expect(out.user).toEqual({ id: "8c1e-uuid" });
    expect(out.request).toEqual({
      url: "https://tracker.slimelab.cc/dashboard?ask=line-1",
      headers: { "user-agent": "Mozilla/5.0" },
    });
    expect(JSON.stringify(out)).not.toMatch(/@shop\.com|\$\d|eyJ/);
  });

  it("drops a user that has no id rather than shipping other fields", () => {
    expect(scrubEvent({ user: { email: "a@b.co" } }).user).toBeNull();
  });

  it("survives circular structures", () => {
    const extra: Record<string, unknown> = { note: "hi a@b.co" };
    extra.self = extra;
    const out = scrubEvent({ extra }) as { extra: Record<string, unknown> };
    expect(out.extra.note).toBe("hi [email]");
    expect(out.extra.self).toBe("[circular]");
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs fetch breadcrumb URLs", () => {
    const out = scrubBreadcrumb({
      category: "fetch",
      data: { url: "https://api.slimelab.cc/auth/v1/verify?token=abc&type=recovery" },
    });
    expect(out.data.url).toBe("https://api.slimelab.cc/auth/v1/verify?token=[redacted]&type=recovery");
  });
});
