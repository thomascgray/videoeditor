# 16-ui-improvements

**Status**: In Progress

## Overview

Rework how vertical space is divided between the render area and the timeline so a project with many lanes no longer squishes the render, plus add an editor-only viewport zoom/pan. Full spec: `SPECS/16-ui-improvements.md`.

Four parts (all in scope; E optional/deferred):
- **A** — Bounded timeline height + internal vertical scroll (root-cause fix for render squish).
- **B** — Resizable render/timeline splitter + collapse toggle.
- **C** — Editor viewport zoom + pan (plain wheel = zoom-to-cursor, space/middle-drag = pan, Fit reset).
- **D** — Canvas-corner zoom control cluster (`− % + Fit`).

**Confirmed decisions:** plain wheel = viewport zoom (timeline keeps Ctrl+wheel); all new state is ephemeral view state (not persisted, not undo); zoom range 25%–400%; timeline default ~35% of window clamped to px.

## Task Context

- **This is a UI/layout + view-state feature ONLY.** No changes to `src/types.ts`, `useProject` reducer, `renderer.ts`, or the export path. `npx tsc -b` must stay green (only typecheck gate). **No dev server / browser automation — static checks only, then hand the user a click-through checklist** (`.claude/skills/verify`, and memory `no-browser-automation`).
- **Root cause** (`App.tsx:414` + `442`): `<Timeline>` is an intrinsic-height flex sibling; height grows `~34px/lane` (`Timeline.tsx:337`), stealing from the Canvas's `flex-1`. Fix = bound the timeline height, scroll lanes internally.
- **Viewport zoom is a pure CSS scale+translate.** `clientToNorm` (`Canvas.tsx:98-107`) reads the live `getBoundingClientRect()`, so a uniform scale+translate on an ancestor of the two canvases is absorbed automatically — **no hit-test/overlay math changes** (same property spec 13 used to avoid an inverse camera transform). Apply the transform to an inner layer wrapping ONLY the two `<canvas>` elements; keep the tooltip + Frame/Live button + new zoom cluster OUTSIDE the transformed layer (`Canvas.tsx:1140-1183`).
- **Export can't be affected** — `ffmpegExport.ts` renders through its own offscreen canvas via `renderFrame`; the on-screen CSS transform never leaks in.
- **View-state precedent**: `cameraView` (`App.tsx:34`), `pixelsPerSecond`/`addedTopLane`/`addedBottomLane` (`Timeline.tsx:99-104`) are all ephemeral `useState`. Follow this. `config.ts persistProject` = false.
- **Timeline current structure** (`Timeline.tsx:347-407`): two-column flex row — fixed gutter (`GUTTER_WIDTH=32`) + scroll area (`overflow-x-auto overflow-y-hidden`). Vertical scroll disabled today. Ruler is `sticky top-0` (no-op currently). Content-column spacers at 548/873 mirror gutter add-lane buttons. Playhead spans full height (`875-880`, `height:100%`). Constants: `LANE_HEIGHT=32, LANE_GAP=2, RULER_HEIGHT=24, CAMERA_TRACK_HEIGHT=32`.
- **A/B layout refactor** (the one real structural change): move to a single dual-scroll container (`overflow-x-auto overflow-y-auto`, bounded height) with ruler+Camera track `sticky top:0` (frozen header), gutter `sticky left:0` (frozen column), top-left corner sticky both axes. App owns `timelineHeight`/`collapsed` (governs the Timeline box → frees Canvas `flex-1`) and renders the splitter; Timeline handles internal scroll + pinned header/gutter. Keep the full-height playhead correct under vertical scroll.
- **Wheel + preventDefault**: use a non-passive native wheel listener via ref+useEffect on the render container (React `onWheel` may be passive) for plain-wheel zoom.
- **Reset viewport to Fit on aspect-ratio change** (`AspectRatioSelector` → dispatch) and re-clamp split/pan on window resize.
- Four distinct "zooms" now — camera zoom (exported), object resize, timeline time-zoom, viewport zoom (editor-only). Keep UI copy distinct; label viewport zoom as "Zoom"/"%" on the viewer, away from the amber camera controls.

## Blockers/Issues

None currently.

## TODO

### Stage 1 — A + B (layout; self-contained, no undo/model impact) ✅ code complete, tsc green
[X] App owns ephemeral `timelineHeight`/`collapsed` state (default ~35% window, clamped min 140 / max window−48−200)
[X] Render a draggable `row-resize` splitter between main content and Timeline; drag adjusts `timelineHeight` within clamp
[X] Collapse/expand toggle: chevron (▾) in Timeline gutter corner collapses; slim bar with Expand (▴) restores
[X] Re-clamp split on window resize (neither region unusable)
[X] Refactor Timeline to a single dual-scroll container: bounded height + `overflow-auto` (both axes)
[X] Pin ruler + Camera track (`sticky top`); freeze gutter (`sticky left`); corner cells sticky both axes. Chose **column-first** layout (gutter column | content column) so the lane-bar block + single full-height playhead stay intact
[X] Object-lane stack scrolls vertically; gutter stays aligned with its lane rows
[X] Playhead is a single full-height element, zIndex 35 (over pinned ruler/Camera z-30, under frozen gutter z-40)
[X] `clientXToTime` helper: all three seek handlers now subtract GUTTER_WIDTH (gutter moved inside the scroll container)
[ ] USER VERIFY: existing timeline interactions unaffected (time-zoom Ctrl+wheel, scrub, clip drag/resize/trim/split, keyframe drag, Camera-track drag, lane add/remove)

### Stage 2 — C + D (viewport zoom/pan) ✅ code complete, build green
[X] Ephemeral `ViewportState { scale, panX, panY }` in Canvas.tsx (identity = fit); `viewportRef` mirror for handlers
[X] Applied the SAME transform to BOTH canvases (not a wrapper) — CSS transform is layout-neutral so the fit box keeps its size; tooltip + Frame/Live button + zoom cluster stay untransformed
[X] Non-passive native wheel listener on the render area → plain-wheel zoom-to-cursor (factor 1.1, clamp 0.25–4)
[X] Pan via middle-mouse-drag (Space+drag dropped — Space is bound to play/pause in App), clamped via `clampPan` so the canvas keeps covering the fit box
[X] Fit/reset button (in the cluster); reset-to-Fit on aspect-ratio change (`useEffect [width,height]`)
[X] Canvas-corner zoom cluster `− [ % ] + Fit` at bottom-right, styled like the Frame/Live button
[ ] USER VERIFY: all canvas gestures at 200% zoom (select/move/resize/rotate, arrow/freehand draw, camera rect edit, out-of-canvas drag, dbl-click text)
[ ] USER VERIFY: export output unchanged with viewport zoomed in (should be — export uses a separate offscreen canvas)

### Fixes found in self-review
[X] z-order bug: bar children (z-40/z-50) would bleed over the frozen gutter (was z-40) and pinned ruler/Camera (was z-30) when lanes scroll under them → raised to gutter z-[70] > playhead 65 > ruler/Camera z-[60]; made Camera track background opaque (amber wash over #111827) so scrolled-under lanes are hidden

### Wrap-up
[X] `npx tsc -b` green; full `npm run build` green
[ ] Hand user a click-through verification checklist (below)

## Work Log

[2026-07-09] Created task doc from spec `SPECS/16-ui-improvements.md` (status READY, open questions resolved).

[2026-07-10] Implemented Stage 1 (A+B) — bounded timeline + internal scroll + splitter + collapse.
- `src/components/Timeline.tsx`: rewrote the root into a single `overflow-auto` (both-axes) scroll container using a **column-first** frozen layout — lane gutter as a `sticky left` column (with its top two cells `sticky top`), ruler + Camera track as `sticky top` rows. Added `clientXToTime` (subtracts GUTTER_WIDTH now that the gutter lives inside the scroll container) and routed all three seek handlers through it. Playhead kept as one full-height element (zIndex 65). Added `onCollapse` prop + collapse chevron (▾) in the gutter corner. z-order: gutter z-[70] > playhead 65 > ruler/Camera z-[60] > bar children ≤ z-50; Camera track background made opaque.
- `src/components/App.tsx`: added ephemeral `timelineHeight`/`timelineCollapsed` view state (default ~35% window, clamped 140..window−48−200), a `row-resize` splitter (window-tracked drag), window-resize re-clamp, and a collapsed slim bar with Expand (▴). Wrapped `<Timeline>` in a fixed-height box.

[2026-07-10] Implemented Stage 2 (C+D) — editor viewport zoom/pan.
- `src/components/Canvas.tsx`: added `ViewportState {scale,panX,panY}` (ephemeral, resets to Fit on aspect change). Applied the same `translate()/scale()` transform (origin 0 0) to BOTH canvases so hit-testing is unchanged (clientToNorm reads the transformed rect). Plain-wheel zoom-to-cursor via a non-passive native listener on the render area; middle-mouse-drag pan tracked on window; `clampPan` keeps the canvas covering the fit box. Added `fitBoxRef`/`renderAreaRef`, a bottom-right zoom cluster (`− % + Fit`), and `zoomAt`/`resetViewport` helpers. Export path untouched (separate offscreen canvas → unaffected).
- Verified: `tsc -b` and `npm run build` both green.

[2026-07-10] Fix (user report): Ctrl+wheel timeline zoom did nothing — the browser page-zoomed instead. Cause: React's `onWheel` is a **passive** listener, so `e.preventDefault()` was ignored. Converted `Timeline.tsx` to a native non-passive `wheel` listener (via `useEffect` on `containerRef`), removed the React `onWheel` prop, and added cursor-anchored zoom (keeps the time under the cursor fixed by restoring `scrollLeft` after the width re-renders). Plain wheel still falls through to native lane scroll. `tsc -b` green.
