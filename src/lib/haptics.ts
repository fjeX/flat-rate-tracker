/**
 * Tiny haptics helper — a short vibration pulse for key moments (timer
 * start/stop, RO save success, destructive confirm). Progressive
 * enhancement only: no-ops on unsupported browsers (all of iOS Safari) and
 * during SSR. Deliberately not wired to every button — haptics on
 * everything is noise, not feedback.
 */
export function tap(): void {
  if (typeof window === "undefined") return;
  try {
    navigator.vibrate?.(15);
  } catch {
    /* ignore — vibration is a nice-to-have, never worth surfacing an error */
  }
}
