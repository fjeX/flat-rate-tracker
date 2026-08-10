<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FRT agent rules

## Required before any commit that touches `.tsx` or `.css`

```bash
npm test          # vitest logic suite — must be green
```

**The visual gate is not run by hand.** `scripts/deploy.sh` runs it on the VM
against the freshly built image in fixture mode, before traffic swaps. A
layout regression rejects the deploy. See README → UI regression tests.

`npm run test:ui` still exists as a local dev convenience (dev server + live bot
data, needs `.env.bot.local`). It drifts with the bot's nightly data and nothing
blocks on it — do not "fix" it by re-recording its baselines.

If the **deploy** gate fails on a look you changed intentionally: review
(`npm run test:ui:report`), then `./scripts/update-baselines.sh` on the VM, and
commit `tests/e2e/__canary__/` in the same commit as the change. Never
re-record to silence a failure you don't understand.

### Fixture mode — the rule that matters when editing auth

`FRT_FIXTURE_MODE=1` freezes the data (`src/lib/fixtures/`), the clock
(`src/instrumentation.ts`), and the request gate (`src/lib/supabase/proxy.ts` —
Next 16's renamed middleware, which runs *before* page code and does **not** go
through `createClient()`).

If you add a fourth place that resolves the current user, give it a
`FIXTURE_MODE` branch. Miss it and every authed route 307s to `/signin`, and the
gate passes having photographed the sign-in page.

## Design-system rules

- No hex colors in `.tsx` — use `var(--…)` tokens from `src/app/globals.css`.
- No ad-hoc radii/shadows/focus rings — use `var(--radius)`, `var(--radius-sm)`,
  `var(--shadow-card)`, `var(--shadow-pop)`, `var(--ring)`.
- Use the primitives in `src/components/ui/` (Button, Input, Select, Card,
  Badge, Field, Table) instead of hand-rolling markup.
- Interactive controls: ≥44×44px on mobile (`--tap-min`). Small icons get the
  `.hit-expand` invisible tap-area pattern.
- Any change to an authed page must land on its `guest/*` mirror in the same
  commit (Timer, Op Codes, RO detail have separate guest components).
- New route → add it to `tests/e2e/routes.ts` and record baselines.

## Hard No's

- Do not run DB migrations locally (local dev points at prod Supabase).
- Do not create accounts or write data against prod — tests use the existing
  bot account, read-only.
- Do not deploy: `Dockerfile` / `docker-compose.yml` changes ship via the VM
  flow in `CLAUDE.md`.
