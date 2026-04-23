# Handoff: Phase 1 — Op Codes library page complete (awaiting user browser test + commit)

## Session Metadata
- Created: 2026-04-22 15:06:23
- Project: /home/slime/Projects/flat_rate_tracker
- Branch: main
- HEAD: 6321f07 (unchanged since last handoff — the op-codes work below is **uncommitted** in the working tree)
- Session duration: ~1 hour

### Recent Commits (for context)
  - 6321f07 Add session handoff: phase 1 Dashboard/Log/History complete
  - 8f78bec Make Log RO's date field actually usable
  - 8cde77e Fix nested-form bug that ate Log RO progress on op-code modals
  - 592f61e Add History page + reusable RO detail modal
  - ea5f564 UX polish on Log RO and Dashboard

### Uncommitted changes in working tree
```
 M package-lock.json                  (dnd-kit install)
 M package.json                       (dnd-kit install)
 M src/app/(app)/op-codes/page.tsx    (placeholder → server page)
 M src/app/actions/op-codes.ts        (+ update/delete/reorder actions)
?? src/components/op-codes/           (NEW dir: 3 components)
?? session-handoff.md                 (pre-existing untracked README, ignore)
```

## Handoff Chain

- **Continues from**: [2026-04-22-130854-phase1-dashboard-log-history-complete.md](./2026-04-22-130854-phase1-dashboard-log-history-complete.md)
  - Previous title: Session Handoff: Phase 1 — Dashboard, Log RO, and History complete
- **Supersedes**: None.

> Read the previous handoff for phase-1 baseline context (stack, local dev prereqs, data layer, patterns, Next 16 quirks). This handoff only covers the Op Codes library delta.

## Current State Summary

The Op Codes library page (`/op-codes`) is fully implemented in the working tree and passes `npm run build`, `tsc --noEmit`, and `eslint`. It is **not committed yet**: the user follows a "verify in browser, then commit" workflow and was asked to test the interactive behaviors (drag reorder, keyboard reorder, search-hides-handles, add/edit/delete modals, Log RO regression) before we create the atomic commit. Three screens remain as `ComingSoon` placeholders: Timer, Pay Period, Settings.

## Codebase Understanding

### Architecture Overview

Nothing structurally new — the op-codes page reuses the established patterns from Log RO and History:
- Server component page fetches data via `db.listOpCodes()` and passes to a client view
- Client view manages local state seeded from the server prop
- Mutations go through server actions that throw on error, client catches and surfaces, both `revalidatePath()` and `router.refresh()` keep data in sync
- Shared `Modal` component auto-unmounts its child on close (child's state resets naturally — avoids `react-hooks/set-state-in-effect` lint)

**New piece:** `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` for drag-and-drop. Chosen over native HTML5 drag because the spec (§4.6) explicitly requires proper mobile/touch support. Integration is small and self-contained — lives only in `OpCodesView` and `OpCodeRow`.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/app/(app)/op-codes/page.tsx` | Server page — fetches library, renders `<OpCodesView>` | Entry point |
| `src/components/op-codes/OpCodesView.tsx` | Client root — search, DndContext, list, add button, modal wiring, optimistic reorder with rollback | Main logic |
| `src/components/op-codes/OpCodeRow.tsx` | Sortable row — `useSortable`, grip handle (dedicated button), code/desc/hours, edit/delete buttons | Row rendering + dnd handle wiring |
| `src/components/op-codes/OpCodeFormModal.tsx` | Shared add/edit modal (`mode: "add" \| "edit"`, optional `initial`) | Modal UI |
| `src/app/actions/op-codes.ts` | Server actions — now has `createLibraryOpCode`, `updateLibraryOpCode`, `deleteLibraryOpCode`, `reorderLibraryOpCodes` | Mutation entry points |
| `src/lib/db/op-codes.ts` | Untouched — already had `listOpCodes`, `createOpCode`, `updateOpCode`, `deleteOpCode`, `reorderOpCodes` | Data layer |
| `src/components/forms/OpCodeModals.tsx` | **Intentionally NOT refactored** — used by Log RO's "create new library op code" flow | Don't touch without care |
| `docs/handoff.md` §4.6 | Product spec for Op Codes tab | Source of truth for required behavior |

### Key Patterns Discovered (beyond previous handoff)

- **Optimistic list reorder in React 19:** plain `useState<OpCode[]>` seeded once from server prop via `useState(() => library)` + `useTransition` for the action. `arrayMove` from `@dnd-kit/sortable` computes the new order in `onDragEnd`; on action failure, revert `setItems(prev)` and show an error banner. Deliberately NOT using `useOptimistic` — that API is tied to `useActionState`, and for user-driven UI state that incidentally triggers an action, explicit rollback is clearer.
- **Drag handle vs. row click-targets:** apply `{...attributes} {...listeners}` **only to the grip `<button>`**, never the whole `<li>`. This lets Edit/Delete buttons in the same row stay clickable. Row gets `setNodeRef` + `style` only.
- **Disabling sortable during search:** `useSortable({ id, disabled: isSearching })`. Grip becomes an invisible spacer (`<div className="h-8 w-8 shrink-0" aria-hidden />`) so row height doesn't jump.
- **PointerSensor with `distance: 6`** covers mouse + touch in one sensor. The 6-px activation threshold prevents accidental drags on tap and lets vertical page scroll initiate before a drag starts.
- **Local state reconciliation without effects:** after each mutation, the action's return value (or a filter for delete) is applied to `items` directly in the action callback — no `useEffect` watching the `library` prop. This both satisfies `react-hooks/set-state-in-effect` and preserves local order during a pending reorder.

## Work Completed

### Tasks Finished

- [x] Installed `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, `@dnd-kit/utilities ^3.2.2`.
- [x] Added `updateLibraryOpCode`, `deleteLibraryOpCode`, `reorderLibraryOpCodes` server actions (following the existing `createLibraryOpCode` shape — trim, validate, call db, revalidate, throw).
- [x] Factored `revalidateOpCodes()` helper (revalidates `/log` and `/op-codes`).
- [x] Built `OpCodeFormModal` (unified add/edit, title + submit label vary by mode, body state resets via Modal unmount).
- [x] Built `OpCodeRow` (sortable row, grip button, edit/delete buttons, uses `fmtHours` from `@/lib/stats`).
- [x] Built `OpCodesView` (search + DndContext + SortableContext + add-button + modals + optimistic reorder w/ rollback + `window.confirm()` delete mirroring `RoDetailModal`).
- [x] Replaced `op-codes/page.tsx` placeholder with async server component fetching `db.listOpCodes()`.
- [x] Verified: `npm run build` clean, `tsc --noEmit` clean, `eslint` clean on new files.

### Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| `package.json` / `package-lock.json` | Added `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | Drag-and-drop reorder is a handoff-spec requirement (touch support) |
| `src/app/(app)/op-codes/page.tsx` (the Op Codes page file) | `ComingSoon` → server component fetching library | Replace placeholder with real screen |
| `src/app/actions/op-codes.ts` | Added 3 new actions + `revalidateOpCodes()` helper | Mutation entry points for edit/delete/reorder |
| `src/components/op-codes/OpCodeFormModal.tsx` | NEW | Shared add/edit modal |
| `src/components/op-codes/OpCodeRow.tsx` | NEW | Sortable row with grip handle |
| `src/components/op-codes/OpCodesView.tsx` | NEW | Client root: search + dnd + list + modals |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Use `@dnd-kit` (not native HTML5 drag) | native drag API, dnd-kit, react-beautiful-dnd | Spec §4.6 requires mobile/touch support; dnd-kit has the cleanest React 19 story |
| Duplicate modal body, don't refactor `NewLibraryBody` | Lift shared body to `OpCodeFields` util; refactor `NewLibraryBody` to accept mode | Log RO has 2 recent bug-fix commits on its op-code flow; the risk of breaking it outweighs ~50 lines of duplication |
| `useState` + `useTransition` for reorder, not `useOptimistic` | `useOptimistic`, `useState` + `useTransition` | `useOptimistic` is built for `useActionState` loops; reorder is user-driven UI state → explicit rollback is clearer |
| `window.confirm()` for delete, not inline two-click | Custom inline confirm with 3s timeout, confirm modal, `window.confirm` | Matches existing `RoDetailModal.handleDelete` exactly; keeps the app's confirm UX uniform |
| Hard delete; rely on schema `on delete set null` for orphaned `entry_op_codes` lines | Soft delete (add `deleted_at`), block deletion if referenced, show count warning | Phase 1 personal use; schema already handles orphans; simplicity wins. Revisit if it bites. |
| Seed local `items` once, never derive from prop each render | `useState(() => library)` + manual reconciliation vs `useEffect` that resets on library change | Avoids clobbering pending optimistic reorders; satisfies `react-hooks/set-state-in-effect` |
| `PointerSensor { distance: 6 }` alone | Separate `TouchSensor` + `MouseSensor`; `PointerSensor` with distance=0 | Single sensor covers both; 6px threshold disambiguates tap from drag and lets scroll initiate |

## Immediate Next Steps

1. **User tests `/op-codes` in the browser.** Golden path and edges to verify (I could not drive a browser from my harness):
   - Add op code (title "New op code", button "Save") → appears at end of list
   - Edit op code → title "Edit op code", button "Save changes" → values persist
   - Delete op code → native confirm dialog → gone
   - Drag to reorder with mouse → persists after page refresh
   - Touch drag via Chrome devtools mobile emulation → 6-px threshold lets page scroll initiate before drag
   - Keyboard reorder → Tab to grip handle, Space picks up, ↑/↓ moves, Space drops
   - Type search query → grip icons disappear, list filters; clear search → grips return
   - Empty search match → "No op codes match." message
   - Regression: Log RO's "Create new library op code" modal still works; new code shows up at `/op-codes`
2. **If user finds issues, iterate.** Likely spots to check first: touch drag conflict with scroll (adjust `distance`), keyboard a11y (ensure grip has `aria-label` describing action — it does: `Reorder ${code}`), error surface when reorder action fails mid-drag.
3. **Commit as one atomic change** once the user greenlights. Suggested commit message pattern based on repo history:
   ```
   Add Op Codes library page with dnd-kit reorder

   - Search + add/edit/delete + drag reorder (dnd-kit for touch support)
   - Three new components under src/components/op-codes/
   - Three new server actions (update/delete/reorder) mirroring existing shape
   - Handle left invisible while searching so reorder can't be done on a filtered subset
   - Hard delete; entry_op_codes.op_code_id is ON DELETE SET NULL so historical ROs survive
   ```
4. **Ask user which screen to build next** — Timer, Pay Period, or Settings. My recommendation stays: Pay Period is the highest product-value screen (closes the whole discrepancy-check loop the app was built for). Timer is the most novel. Settings is the smallest.

## Blockers/Open Questions

- None technical. The only question is the usual: is the UI acceptable to the user? If not, iterate before committing.

## Deferred Items

- **Warn-with-count on delete-of-referenced op-code.** Defaulted to hard delete + `on delete set null`. If the user finds blank-named lines on old ROs annoying, we can add a reference-count query + warning. Not in scope for this commit.
- **Atomic RPC for `createEntry` / `updateEntry`** — still pending from previous handoff's tech-debt list. Low priority.
- **Timer-running pulse on Nav** — will need a client context or server-prop threading when Timer screen lands.

## Important Context

- **The work is uncommitted.** HEAD is still `6321f07`. Do not start a new feature on top of the op-codes work until the user confirms + commits it. If the user asks to change behavior, iterate in place and commit once they're happy.
- **User flow:** they verify UI in browser, then explicitly ask for commits. Don't auto-commit. Commit bodies should explain *why*, match the existing repo style (see `git log`), include a blank line between title and body, and bullet-list the significant changes.
- **User is new to web dev** (per memory). When explaining non-obvious changes, walk through what you did at a high level first. They've caught 2 UX regressions already — be thorough about edge cases.
- **Don't refactor `src/components/forms/OpCodeModals.tsx`.** It powers Log RO's "create new library op code" flow which has already had two round-trip bug fixes. Duplication was deliberate.
- **`window.confirm` is the app's destructive-action UX.** `RoDetailModal` uses it; `OpCodesView` matches. Don't introduce a third pattern without asking.
- **Don't derive `items` from `library` prop each render in `OpCodesView`.** There is deliberately no `useEffect` on the prop — it would clobber pending optimistic reorders. Reconcile inside action callbacks.
- **Touch drag threshold (`distance: 6`) is a tuning knob.** If the user reports drags triggering when they mean to scroll on mobile, raise to 8 or 10. If drags feel sluggish to start, lower to 4. Default chosen from dnd-kit recipes.

## Assumptions Made

- The user will verify in browser before committing — I did not start a dev server from my harness.
- Hard delete + FK-set-null is acceptable UX for phase 1 (handoff spec doesn't prescribe either way).
- Add flow lands the new op code at the **end** of the list (because `createOpCode` auto-appends `sort_order = max+1`). Haven't seen this behavior confirmed by user preference, but it matches `docs/handoff.md` §3.2 "Order matters — library order is preserved."
- `npm run build` passing + `tsc --noEmit` clean + `eslint` clean is sufficient to hand off for UI verification. Runtime errors on the op-codes route would still need to be caught by the user's manual test.

## Potential Gotchas

- **Hydration warning in dev:** Dashlane/1Password on `/signin` is a known benign thing (noted in previous handoff). Should not apply to `/op-codes` since no password fields, but if you see a hydration warning somewhere, check for the same root cause.
- **Port 3000 orphan dev server:** previous handoff gotcha #1 still applies. `kill -9` the PID shown if `npm run dev` complains.
- **Next.js 16 `params`/`searchParams` are Promises.** The new `op-codes/page.tsx` doesn't use either, but keep this in mind for future routes.
- **`SortableContext items` must match rendered children exactly.** During search, we pass `visible.map(op => op.id)` (filtered list) — do NOT pass the full `items` ids with filtered children, or dnd-kit will crash.
- **Grip hitbox on touch:** it's `h-8 w-8` (32×32). If the user complains about hitting it with gloves, bump to `h-10 w-10` (40×40) — still within a reasonable row height.
- **Lucide icon names used:** `GripVertical`, `Pencil`, `Trash2`, `Plus`, `Search`, `X`. All are already available in the `lucide-react` version installed.

## Environment State

### Tools/Services Used

- Supabase local stack: running (verified `npx supabase status` before session end)
- Node: whatever the system has (the user's Arch laptop); works with Next 16.2.4
- Next dev server: **not currently running from my session**; user should `npm run dev` to test

### Active Processes

- `supabase` Docker containers (started before this session; left running)
- No dev server started by me

### Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL` (local dev points to http://127.0.0.1:54321)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (local dev publishable key from `npx supabase status`)
- Both live in `.env.local` (gitignored); `.env.example` is the committed template.

## Related Resources

- [Previous handoff (phase 1 Dashboard/Log/History)](./2026-04-22-130854-phase1-dashboard-log-history-complete.md) — baseline context.
- `docs/handoff.md` §4.6 — product spec for this screen.
- `src/lib/db/op-codes.ts` — unchanged data layer that backs the new actions.
- `src/components/forms/OpCodeModals.tsx` — the modal body we deliberately did NOT refactor.
- `src/components/history/HistoryView.tsx` — the search-input + summary-card pattern we mirrored.
- `src/components/ro/RoDetailModal.tsx` — source of the `window.confirm` delete pattern.
- dnd-kit docs: https://docs.dndkit.com — sensors, SortableContext, arrayMove.

---

**Security Reminder**: Before finalizing, run `validate_handoff.py` to check for accidental secret exposure.
