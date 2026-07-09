# Flat Rate Tracker

Next.js app for logging automotive repair orders and tracking flat-rate pay.

## Development

```bash
npm run dev        # dev server on http://localhost:3000
npm test           # logic tests (vitest, src/lib/*.test.ts)
```

Local dev points at **production Supabase** (`api.slimelab.cc`) — never run
migrations locally; see `CLAUDE.md` for the VM deploy flow.

## UI regression tests (required before committing UI changes)

Any commit touching `.tsx` or `.css` must pass the UI suite first:

```bash
npm run test:ui
```

What it does — for **every route**, in **dark + light**, at **390px + 1440px**:

- **Visual snapshots** (`tests/e2e/visual.spec.ts`) — pixel-compares each page
  against the approved baselines in `tests/e2e/visual.spec.ts-snapshots/`.
  Live data (the bot account's ROs, dates, charts) is masked via `tests/e2e/routes.ts`.
- **Quality checks** (`tests/e2e/quality.spec.ts`) — mechanical assertions that
  don't need baselines: no horizontal overflow, no clipped text, visible
  keyboard-focus rings, ≥44px touch targets on mobile.

### Auth

Authed routes sign in as the **bot account** (same one the nightly QA bot uses).
Provide credentials once in `.env.bot.local` (gitignored):

```
FRT_BOT_EMAIL=...
FRT_BOT_PASSWORD=...
```

(Same values as `~/.frt-bot.env` on the VM.) Alternatively an exported session
at `tests/.auth/bot-state.json` is used as-is. Tests are read-only — they never
create or modify data.

### Accepting an intentional look change

When you *meant* to change how something looks, the visual tests will fail —
that's them working. Review the diff, then re-record the baselines:

```bash
npm run test:ui:report   # open the HTML report, eyeball expected/actual/diff
npm run test:ui:update   # accept: re-record baselines from the current UI
```

Commit the updated `*-snapshots/*.png` together with the code change so the
approved look and the code that produces it travel in the same commit.

### Adding a route

New page = add one entry to `tests/e2e/routes.ts` (path + which selectors hold
live data), run `npm run test:ui:update`, commit the new baselines.

## Design system

Tokens live in `src/app/globals.css` (`--bg-*`, `--fg-*`, `--brand`, `--radius`,
`--ring`, `--tap-min`, …). Components consume tokens — **no hex colors in
`.tsx`**, no ad-hoc radii. Use the primitives in `src/components/ui/`
(`Button`, `Input`, `Select`, `Card`, `Badge`, `Field`, `Table`) instead of
hand-rolling. The quality suite enforces the ergonomics; the snapshot suite
enforces the look.
