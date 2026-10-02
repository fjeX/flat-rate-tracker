import { describe, expect, it } from "vitest";
import { Refusal, isRefusal, refusable, refusalToResult } from "./refusal";

describe("Refusal", () => {
  it("is an Error with its own name and keeps the sentence", () => {
    const r = new Refusal("That RO is already on a timer.");
    expect(r).toBeInstanceOf(Error);
    expect(r.name).toBe("Refusal");
    expect(r.message).toBe("That RO is already on a timer.");
    expect(isRefusal(r)).toBe(true);
    expect(isRefusal(new Error("x"))).toBe(false);
  });

  it("refusable turns a thrown Refusal into { error } and nothing else", async () => {
    await expect(
      refusable(async () => {
        throw new Refusal("Pick an op code to save this time to.");
      }),
    ).resolves.toEqual({ error: "Pick an op code to save this time to." });
    await expect(refusable(async () => ({ ok: true }))).resolves.toEqual({ ok: true });
    await expect(
      refusable(async () => {
        throw new Error("a genuine bug");
      }),
    ).rejects.toThrow("a genuine bug");
  });

  it("refusalToResult rethrows non-refusals", () => {
    expect(refusalToResult(new Refusal("no"))).toEqual({ error: "no" });
    expect(() => refusalToResult(new TypeError("boom"))).toThrow(TypeError);
  });
});
