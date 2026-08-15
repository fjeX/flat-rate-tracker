"use client";

import { useSyncExternalStore } from "react";

// Hydration-safe reads of values that only exist in the browser.
//
// WHY THIS EXISTS
// Every component that remembered something in localStorage had grown the same
// shape: seed state with a default, then adopt the real value in a mount effect.
// That pattern is not wrong — reading localStorage during render is genuinely
// unsafe, because the server has no localStorage and the first client render
// must match the SSR HTML byte for byte or React throws a hydration error. But
// it is what `react-hooks/set-state-in-effect` flags, and the rule is pointing
// at something real: the value arrives one render late, and every call site
// re-implemented the dance slightly differently.
//
// `useSyncExternalStore` is React's answer to exactly this. It takes a server
// snapshot (used for SSR and the hydrating render) and a client snapshot (used
// forever after), so React performs the swap itself instead of each component
// faking it with an effect.
//
// It also fixed a real bug for free. "frt:quick_add_enabled" was read in two
// places that each held private state, so toggling Quick Add in Settings left
// the dashboard showing the old value until a reload. One store means both
// components observe the same write immediately.

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  // `storage` only fires for writes made by OTHER tabs, which is why our own
  // writes have to call emit() explicitly. Both paths are needed: without the
  // listener a second tab drifts, without emit() the writing tab drifts.
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

// getSnapshot MUST return an Object.is-equal value when nothing changed, or
// React re-renders in a loop. Parsing on every call would return a fresh object
// each time, so results are memoised against the raw string they came from.
const snapshots = new Map<string, { raw: string | null; value: unknown }>();

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode, or storage disabled entirely.
    return null;
  }
}

export function readStored<T>(key: string, parse: (raw: string) => T, fallback: T): T {
  const raw = readRaw(key);
  const cached = snapshots.get(key);
  if (cached && cached.raw === raw) return cached.value as T;

  let value: T;
  try {
    value = raw === null ? fallback : parse(raw);
  } catch {
    // Malformed value (hand-edited, or written by an older version). Treat it
    // as absent rather than throwing during render.
    value = fallback;
  }
  snapshots.set(key, { raw, value });
  return value;
}

// Every write goes through here, so readers are notified. A bare
// localStorage.setItem() elsewhere will persist but leave the UI stale.
export function writeStored(key: string, raw: string | null): void {
  try {
    if (raw === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
  } catch {
    // Storage full or disabled. The write is best-effort, but still notify so
    // in-memory readers agree with each other about what was attempted.
  }
  snapshots.delete(key);
  emit();
}

/**
 * Read a localStorage-backed value. Returns `serverValue` during SSR and the
 * hydrating render, then the stored value.
 *
 * `fallback` and `serverValue` must be stable references (a primitive, or a
 * module-level constant) — an inline object literal changes identity every
 * render and defeats the snapshot check.
 */
export function useStored<T>(
  key: string,
  parse: (raw: string) => T,
  fallback: T,
  serverValue: T = fallback,
): T {
  return useSyncExternalStore(
    subscribe,
    () => readStored(key, parse, fallback),
    () => serverValue,
  );
}

const noopSubscribe = () => () => {};

/**
 * Read a browser-only value that nothing else in the app writes — the detected
 * IANA timezone, say. Same hydration swap as `useStored`, without a store.
 *
 * `read` must return an Object.is-equal value on every call (a primitive, or a
 * memoised object), for the same reason as above.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noopSubscribe, read, () => serverValue);
}
