// validate() — server-action-thrown-refusals-masked (2026-10-01).
//
// A validation sentence is written for the tech, so validate() throws a
// Refusal: an action wrapped in refusable() RETURNS it as { error } (a thrown
// one is masked in production), and an unwrapped action still throws an Error
// subclass exactly as before.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validate } from "./core";
import { Refusal, refusable } from "@/lib/refusal";

const schema = z.object({ n: z.number({ error: "N must be a number." }) });

describe("validate", () => {
  it("returns the parsed value on success", () => {
    expect(validate(schema, { n: 1, extra: true })).toEqual({ n: 1 });
  });

  it("throws a Refusal carrying the first issue's sentence", () => {
    let caught: unknown;
    try {
      validate(schema, { n: "x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Refusal);
    expect(caught).toBeInstanceOf(Error); // unwrapped callers see no change
    expect((caught as Error).message).toBe("N must be a number.");
  });

  it("inside refusable() the sentence comes back as data", async () => {
    await expect(
      refusable(async () => ({ ok: validate(schema, { n: "x" }) })),
    ).resolves.toEqual({ error: "N must be a number." });
  });
});
