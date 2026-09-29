// How long the close form waits for getCloseDefaultsAction before calling the
// fetch stalled. A healthy answer is one round trip; a request that has neither
// answered nor errored after this long is a dead connection (no FIN, no RST),
// which would otherwise leave the form on "Loading…" forever.
export const CLOSE_DEFAULTS_TIMEOUT_MS = 15_000;

// A stalled fetch can't be retried in place. Next's App Router runs every
// client-side server-action call through ONE sequential queue
// (next/dist/client/app-call-server.js → dispatchAppRouterAction →
// app-router-instance.js dispatchAction): while an action is pending, the next
// one is appended to the queue and only starts when the pending one settles.
// A retry of a hung call would sit behind it and hang too. A full page load
// throws the stuck queue away. Its own module so tests can observe the click.
export function reloadPage() {
  window.location.reload();
}
