<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FRT agent rules

## Required before any commit that touches `.tsx` or `.css`

```bash
npm test          # vitest logic suite — must be green
npm run test:ui   # visual snapshots + UI quality gates — must be green
```

`npm run test:ui` starts the dev server if needed and requires bot credentials
in `.env.bot.local` or a session at `tests/.auth/bot-state.json`
(see README → UI regression tests).

If a visual test fails because you **intentionally** changed the look:
review the diff (`npm run test:ui:report`), then `npm run test:ui:update`
and commit the refreshed baselines **in the same commit** as the change.
Never update baselines to silence a failure you don't understand.

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
