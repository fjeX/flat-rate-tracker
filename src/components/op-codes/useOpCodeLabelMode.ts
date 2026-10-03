"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which field leads each op code row: the code (default) or the description.
// A per-device display preference, so it lives in localStorage, not the DB.
export type OpCodeLabelMode = "code" | "description";

export const LABEL_MODE_KEY = "frt-op-code-label-mode";
const DEFAULT_MODE: OpCodeLabelMode = "code";

const listeners = new Set<() => void>();

function read(): OpCodeLabelMode {
  try {
    return localStorage.getItem(LABEL_MODE_KEY) === "description" ? "description" : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

// The server snapshot is always the default, so hydration matches; React then
// re-reads the real value after mount.
export function useOpCodeLabelMode(): [OpCodeLabelMode, (m: OpCodeLabelMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => DEFAULT_MODE);
  const setMode = useCallback((next: OpCodeLabelMode) => {
    try {
      localStorage.setItem(LABEL_MODE_KEY, next);
    } catch {
      /* private mode / blocked storage: the choice just won't persist */
    }
    listeners.forEach((l) => l());
  }, []);
  return [mode, setMode];
}
