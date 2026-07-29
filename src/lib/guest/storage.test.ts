import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUEST_CLAIM_KEY,
  GUEST_STORAGE_KEY,
  clearGuestSession,
  hasGuestClaim,
  markGuestClaim,
} from "./storage";

/** Minimal sessionStorage stand-in — the vitest env is `node`, which has none. */
function installSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

describe("guest session storage", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The bug this guards: guest ROs sitting in sessionStorage were treated as
  // permission to write them into whatever account the tab was signed into, so
  // a signed-in user browsing /guest had throwaway ROs land in real history.
  it("does not report a claim just because guest data exists", () => {
    store.set(GUEST_STORAGE_KEY, JSON.stringify({ entries: [{ id: "x" }] }));
    expect(hasGuestClaim()).toBe(false);
  });

  it("reports a claim only after the explicit hand-off", () => {
    expect(hasGuestClaim()).toBe(false);
    markGuestClaim();
    expect(hasGuestClaim()).toBe(true);
  });

  it("clears the data and the claim together", () => {
    store.set(GUEST_STORAGE_KEY, "{}");
    markGuestClaim();

    clearGuestSession();

    expect(store.has(GUEST_STORAGE_KEY)).toBe(false);
    expect(store.has(GUEST_CLAIM_KEY)).toBe(false);
    // A second dashboard visit must not re-sync stale data.
    expect(hasGuestClaim()).toBe(false);
  });

  it("fails closed when sessionStorage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });

    expect(hasGuestClaim()).toBe(false);
    expect(() => markGuestClaim()).not.toThrow();
    expect(() => clearGuestSession()).not.toThrow();
  });
});
