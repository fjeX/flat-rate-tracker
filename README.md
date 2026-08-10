# Flat Rate Tracker

Next.js app for logging automotive repair orders and tracking flat-rate pay.

## Development

```bash
npm run dev        # dev server on http://localhost:3000
npm test           # logic tests (vitest, src/lib/*.test.ts)
```

Local dev points at **production Supabase** (`api.slimelab.cc`) — never run
migrations locally; see `CLAUDE.md` for the VM deploy flow.

## UI regression tests

**The gate is automatic — it runs inside `scripts/deploy.sh`, not on your
machine.** After the image builds and before traffic swaps, deploy.sh runs that
same image on `127.0.0.1:3901` with `FRT_FIXTURE_MODE=1` and photographs every
route × dark/light × 390px/1440px from inside a pinned Playwright container. A
regression rejects the deploy before it reaches the site.

- **Visual snapshots** (`tests/e2e/visual.spec.ts`) — pixel-compares each page
  against the baselines in `tests/e2e/__canary__/`.
- **Quality checks** (`tests/e2e/quality.spec.ts`) — mechanical assertions that
  need no baselines: no horizontal overflow, no clipped text, visible
  keyboard-focus rings, ≥44px touch targets on mobile.

### Why fixture mode exists

The suite used to photograph the bot account's **live** data. The bot logs ROs
nightly, so pages kept growing and the baselines failed on a schedule —
`/history` drifted 2580px → 4495px with no CSS change at all. Masking hid the
pixels but not the height, and a gate that cries wolf gets rubber-stamped.

`FRT_FIXTURE_MODE=1` pins **both** the data and the clock (frozen data alone
still drifts as "days left in this period" counts down):

| Piece | Where | Covers |
|---|---|---|
| Data + auth | `src/lib/fixtures/` via `createClient()` | all db calls + direct `auth.getUser()` |
| Clock | `src/instrumentation.ts` | the six independent "now" reads |
| Request gate | `src/lib/supabase/proxy.ts` | Next 16 middleware — runs *before* page code |

It's runtime-only (not `NEXT_PUBLIC_*`), so **one image serves both prod and the
canary** — the gate tests the exact bytes that ship.

Because nothing churns, fixture snapshots **mask nothing** and run at
`maxDiffPixelRatio: 0.002`. Numerals and charts are genuinely compared.

> Adding another place the app resolves the current user? Give it a
> `FIXTURE_MODE` branch. Miss one and the gate quietly photographs `/signin`.

### Accepting an intentional look change

```bash
npm run test:ui:report          # eyeball expected / actual / diff
./scripts/update-baselines.sh   # VM only — rebuild + re-record
```

Commit the images in `tests/e2e/__canary__/` **with** the change that caused
them. Never re-record to silence a failure you haven't understood.

### Adding a route

Add an entry to `tests/e2e/routes.ts`, then re-record baselines. If the page
shows a new kind of data, add rows for it in `src/lib/fixtures/data.ts` —
otherwise it renders its empty state (unknown tables resolve to `[]`, never an
error), which snapshots fine but tests less.

### `npm run test:ui` — local, optional

Runs against your dev server and the live bot account, so it still drifts and
still needs `.env.bot.local` (`FRT_BOT_EMAIL` / `FRT_BOT_PASSWORD`, same values
as `~/.frt-bot.env`). Keeps its own `-win32` baselines under
`tests/e2e/visual.spec.ts-snapshots/`. It's a dev convenience — nothing blocks
on it.

## Design system

Tokens live in `src/app/globals.css` (`--bg-*`, `--fg-*`, `--brand`, `--radius`,
`--ring`, `--tap-min`, …). Components consume tokens — **no hex colors in
`.tsx`**, no ad-hoc radii. Use the primitives in `src/components/ui/`
(`Button`, `Input`, `Select`, `Card`, `Badge`, `Field`, `Table`) instead of
hand-rolling. The quality suite enforces the ergonomics; the snapshot suite
enforces the look.
