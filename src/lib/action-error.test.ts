import { describe, it, expect } from "vitest";
import { actionErrorMessage, isStaleDeployError, STALE_DEPLOY_MESSAGE } from "./action-error";

// The exact text a reporter pasted in bug 33cbab9e.
const STALE =
  'Server Action "6089742bbe07220f2b53e24e9ae0a7076a9b226d62" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action';

describe("isStaleDeployError", () => {
  it("recognises the stale Server Action ID error from an older build", () => {
    expect(isStaleDeployError(new Error(STALE))).toBe(true);
    expect(isStaleDeployError(STALE)).toBe(true);
    expect(isStaleDeployError(new Error("Server Reference ID did not match the expected format"))).toBe(true);
  });

  it("leaves ordinary errors alone", () => {
    expect(isStaleDeployError(new Error("RO number is required"))).toBe(false);
    expect(isStaleDeployError(null)).toBe(false);
    expect(isStaleDeployError({ message: STALE })).toBe(false);
  });
});

describe("actionErrorMessage", () => {
  it("swaps the raw Next.js text for an explanation and a fix", () => {
    expect(actionErrorMessage(new Error(STALE), "Failed to save.")).toBe(STALE_DEPLOY_MESSAGE);
  });

  it("otherwise behaves exactly like the old inline expression", () => {
    expect(actionErrorMessage(new Error("boom"), "Failed to save.")).toBe("boom");
    expect(actionErrorMessage("boom", "Failed to save.")).toBe("Failed to save.");
    expect(actionErrorMessage(undefined, "Failed to save.")).toBe("Failed to save.");
  });
});
