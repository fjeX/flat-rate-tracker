// The reply kind decides which notice a tech sees ("your bug got fixed" vs a
// plain note), so the mapping from saved status is pinned here.
import { describe, it, expect } from "vitest";
import { replyKindFor, thankYouTemplate } from "./feature-requests";

describe("replyKindFor", () => {
  it("makes a Resolved bug a fixed thank-you", () => {
    expect(replyKindFor("bug", "Resolved")).toBe("fixed");
  });

  it("makes a Shipped request a shipped thank-you", () => {
    expect(replyKindFor("feature", "Shipped")).toBe("shipped");
  });

  it("keeps everything else a note — including the other source's done word", () => {
    expect(replyKindFor("bug", "Triaged")).toBe("note");
    expect(replyKindFor("bug", "Shipped")).toBe("note");
    expect(replyKindFor("feature", "Resolved")).toBe("note");
    expect(replyKindFor("feature", "Planned")).toBe("note");
  });
});

describe("thankYouTemplate", () => {
  it("greets by first name when there is one", () => {
    expect(thankYouTemplate("fixed", "Sam")).toMatch(/^Hey Sam, the bug you reported is fixed/);
    expect(thankYouTemplate("shipped", "Sam")).toMatch(/^Hey Sam, your idea made it into the app/);
  });

  it("still reads right with no name", () => {
    expect(thankYouTemplate("fixed", null)).toMatch(/^Hey, the bug/);
  });

  it("has nothing to offer for a plain note", () => {
    expect(thankYouTemplate("note", "Sam")).toBeNull();
  });
});
