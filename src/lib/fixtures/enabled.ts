/**
 * Fixture mode — the switch that makes the app render a frozen world.
 *
 * WHY THIS EXISTS
 * The visual regression suite used to snapshot the bot account's live prod data.
 * The bot logs new ROs every night, so every page grew taller over time and the
 * baselines failed on a schedule — /history drifted 2580px → 4495px with zero
 * CSS changes. Masking the dynamic regions didn't help: a mask hides the pixels
 * but not the height. A gate that fails for reasons unrelated to the diff trains
 * you to rubber-stamp it, so the gate stopped meaning anything.
 *
 * Under FRT_FIXTURE_MODE the app serves a fixed dataset at a fixed point in
 * time, so a snapshot only changes when the DESIGN changes.
 *
 * SERVER-ONLY ON PURPOSE
 * This is deliberately not a NEXT_PUBLIC_* var. Those are inlined into the
 * client bundle at build time, which would mean a separate image for fixture
 * mode. Read server-side only, one image serves both prod and the canary — so
 * the visual gate tests the exact bytes that ship.
 *
 * Never set this in the real app service. docker-compose.yml sets it on
 * app-canary only.
 */
export const FIXTURE_MODE = process.env.FRT_FIXTURE_MODE === "1";

/**
 * The instant the frozen world is pinned to. Every date the app derives —
 * "today", the current pay period, "3 days ago" — resolves against this.
 *
 * Chosen mid-month and mid-week on purpose: a boundary date would hide
 * off-by-one bugs in period math behind a snapshot that happens to look right.
 */
export const FIXTURE_NOW_ISO = "2026-03-12T17:30:00.000Z";
export const FIXTURE_NOW_MS = Date.parse(FIXTURE_NOW_ISO);
