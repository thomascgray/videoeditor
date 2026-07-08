# 10-typescript-build-fixes

## Overview

`npm run build` (`tsc -b && vite build`) currently **fails** on a set of pre-existing TypeScript errors. The dev server (`vite`, esbuild) strips types without checking them, so the app runs fine in development and the breakage has gone unnoticed — but there is no green production build and no typecheck gate. This ticket is to clear the errors properly (no blanket `any`), get `tsc -b` to exit 0, and optionally add a guard so it doesn't regress.

## Current errors (from `tsc -b`, 2026-07-07)

Two categories:

### Trivial — dead identifiers (just delete)
1. `src/components/App.tsx(2)` — `AssetMeta` imported but unused.
2. `src/components/Canvas.tsx(5)` — `quadBezierAt` imported but unused.
3. `src/components/Canvas.tsx(814)` — `dblClickTimerRef` declared but unused.
4. `src/components/Canvas.tsx(816)` — parameter `e` declared but unused.
5. `src/components/ImportModal.tsx(6)` — `getAssetUrl` imported but unused.

### Real type issues (need a proper fix)
6. `src/components/App.tsx(108)` — `tightenBbox`: the computed `newData` is assigned to `UPDATE_OBJECT.updates.data` (type `TimelineObject['data']`) but doesn't narrow. Root cause: `{ ...obj.data, points: ... }` spreads `obj.data` while it's still the full `PhotoData | … | VideoData` union, so TS widens `newData` to a shape it can't assign back to the data union (and `ShapeData = Record<string, never>` makes the union assignment strictly fail).
7. `src/lib/exportWorker.ts(159)` — `renderFrame(ctx, …)` is called with an `OffscreenCanvasRenderingContext2D`, but `renderFrame`'s signature declares `ctx: CanvasRenderingContext2D`. (Dead code today, but this file is resurrected by spec 09 **B4**, so the fix is needed there regardless.)

## Requirements

- **R1**: `npm run build` exits 0 (both `tsc -b` and `vite build` succeed).
- **R2**: No new `any`, `@ts-ignore`, or `@ts-expect-error` used as a shortcut. Errors 1–5 are deletions; 6–7 get real type fixes.
- **R3**: No behavioral change. These are type-only fixes; runtime output must be identical.
- **R4 (optional)**: Prevent regression — decide whether to run `tsc -b` (or `npm run build`) in CI / a pre-commit hook so the typecheck can't silently rot again.

## Technical Considerations

### Types involved
- `ProjectAction` union (`src/types.ts:106-118`): `UPDATE_OBJECT` carries `updates: Partial<Omit<TimelineObject, 'id' | 'type'>>`, so `updates.data` is `TimelineObject['data']` = `PhotoData | ArrowData | TextData | ShapeData | FreehandData | AudioData | VideoData`.
- `ShapeData = Record<string, never>` (`src/types.ts:56`) — its `never` index signature is why a loosely-typed object won't assign to the data union.
- `renderFrame` (`src/lib/renderer.ts:21-28`) declares `ctx: CanvasRenderingContext2D`. `OffscreenCanvas.getContext('2d')` returns `OffscreenCanvasRenderingContext2D`. Both implement the 2D drawing surface methods `renderFrame`/`drawImageCover` actually use (`fillRect`, `save`, `translate`, `rotate`, `restore`, `drawImage`, `globalAlpha`, `fillStyle`).

### Suggested fixes (errors 6–7)
- **#6**: narrow `newData` at the source — annotate it `const newData: ArrowData | FreehandData = …` and cast the spread base in the arrow branch (`{ ...(obj.data as ArrowData), points: … }`). Avoid casting the whole `data:` field at the dispatch site (that hides future mistakes).
- **#7**: widen `renderFrame`'s `ctx` param to `CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D`. This is the minimal correct change and unblocks B4's OffscreenCanvas usage. Verify `drawImageCover`'s param type is compatible (it takes the same ctx).

## Related Systems and Tasks

- Overlaps with **spec 09 / B4** (`SPECS/09-in-video-perf.md`): error #7 lives in `exportWorker.ts`, which B4 resurrects. Either fix it here and B4 inherits it, or fold #7 into B4 — decide in Open Questions.
- `src/types.ts` (all the types above), `src/lib/renderer.ts` (renderFrame signature).

## Open Questions

1. **CI/pre-commit for typecheck?** Adding `tsc -b` to a hook prevents recurrence but adds friction. Want it? *(Recommended: yes, at least in CI.)*
2. **Fix #7 here or in B4?** It's a one-line signature widen that both need. *(Recommended: fix here so `build` is green now; B4 just uses it.)*
3. Any of the "unused" identifiers actually half-wired features that should be *completed* rather than deleted (e.g. `dblClickTimerRef` — was a double-click handler intended)? Quick check before deleting.

## Acceptance Criteria

- `npm run build` completes with exit 0.
- No `any`/ts-ignore shortcuts introduced.
- App behaves identically (manual smoke: load project, play, export).

## Implementation Notes

- Errors 1–5: delete the identifiers/imports; for `e` (Canvas:816) confirm it's a truly unused handler param before removing.
- Error 6: see suggested fix above; the arrow/freehand branches in `tightenBbox` (`App.tsx` ~82-108).
- Error 7: widen `renderFrame` ctx param in `renderer.ts`.
- After fixing, run `npx tsc -b` (expect clean) and `npx vite build`.
