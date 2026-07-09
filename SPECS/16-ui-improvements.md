# 16-ui-improvements

> **Status: READY FOR IMPLEMENTATION** — Open Questions resolved (2026-07-09). Scope: rework how vertical space is divided between the render area and the timeline so a project with many lanes no longer squishes the render, plus add an editor-only viewport zoom/pan. This is a **UI/layout + view-state feature only — it does NOT touch the data model, reducer, renderer, or export path.**
>
> **Confirmed decisions:** full scope **A+B+C+D** (E optional/deferred); **plain mouse-wheel = viewport zoom** over the render area (Ctrl+wheel stays the timeline's time-zoom); **all new view state is ephemeral** (not persisted across refresh, not undo) — consistent with `cameraView` and `persistProject: false`.

## Overview

Today the editor divides its vertical space badly. In `App.tsx` the window is `h-screen flex flex-col`: a fixed header, then a **main content** row (`flex-1`, holds the Canvas + PropertiesPanel), then the **Timeline** as an intrinsic-height sibling. The Timeline has **no height bound** — it grows by `LANE_HEIGHT (32) + LANE_GAP (2)` per lane (`Timeline.tsx:337`). Because it's a natural-height flex sibling, every lane added steals height from the Canvas's `flex-1`, and the Canvas just re-letterboxes smaller (`max-w-full max-h-full` + `aspect-ratio`, `Canvas.tsx:1141-1146`). **Net effect: add clips → the render preview shrinks.**

This spec breaks that coupling and borrows the conventions every mature NLE (Premiere, DaVinci Resolve, CapCut, Final Cut) already settled on:

1. **Bounded timeline with internal vertical scroll (A).** The timeline gets a height cap; extra lanes scroll *inside* the timeline instead of pushing the render. The time-ruler and Camera track stay pinned. This is the root-cause fix — every NLE scrolls its track stack rather than shrinking the program monitor.
2. **A resizable render/timeline splitter + collapse (B).** A draggable divider between the render area and the timeline (Premiere/Resolve panel dividers; CapCut's fixed-but-collapsible bottom). Plus a one-click collapse to reclaim the whole render while composing.
3. **Editor viewport zoom + pan (C).** Mouse-wheel zoom-to-cursor and pan over the render area — the "program monitor / canvas zoom" that Figma, Photoshop, and every NLE's viewer have. **This is an editor-only view of the canvas — it is NOT the camera zoom (spec 13, which is a real render effect that gets exported), NOT object resize, and NOT the timeline's horizontal time-zoom.** It never changes the rendered/exported output.
4. **Discoverable zoom controls (D)** and **optional compact/vertical-zoom lanes (E)** as supporting polish.

Because coordinates are normalized 0–1 and hit-testing reads the live element rect, viewport zoom is implementable as a pure CSS transform with **no changes to the hit-test/overlay math** (see Technical Considerations). And because export renders through a separate offscreen canvas (`ffmpegExport.ts` → `renderFrame`), the on-screen viewport transform **cannot** affect export by construction.

### What exists today (grounded, verified 2026-07-09)

- **App layout** (`App.tsx:323-465`): root `div.h-screen.flex.flex-col`; header `h-12 shrink-0` (326); main content `<div className="flex-1 flex min-h-0">` holding `<Canvas>` + `<PropertiesPanel>` (414-439); `<Timeline>` as the next sibling (442-453) with **no `flex-1`, no `shrink-0`, no height cap** — it takes intrinsic content height.
- **Timeline height is intrinsic** (`Timeline.tsx:345-346`): root `<div … style={{ minHeight: 120 }}>`. Height ≈ `RULER_HEIGHT (24) + CAMERA_TRACK_HEIGHT (32) + addLaneAbove (32) + trackHeight + addLaneBelow (32)` where `trackHeight = laneCount * (LANE_HEIGHT + LANE_GAP) + LANE_GAP` (337). So ~156px at 1 lane, ~394px at 8 lanes, and it just keeps growing.
- **Timeline internal structure** (`Timeline.tsx:347-407`) is a **two-column flex row**: a fixed-width **gutter** column (`GUTTER_WIDTH = 32`, holds ruler spacer + Camera label + add-lane buttons + per-lane remove buttons, heights hand-mirrored to the content column) and a **scroll area** (`overflow-x-auto overflow-y-hidden flex-1`, 405-409). Vertical scroll is **currently disabled** (`overflow-y-hidden`). The ruler is `sticky top-0` inside the scroll area (412-413) — a no-op today because there's no vertical scroll. Content-column spacers (`<div style={{ height: LANE_HEIGHT }} />` at 548, 873) manually align the two columns against the gutter's add-lane buttons.
- **Timeline horizontal zoom already exists** (`Timeline.tsx:99, 132-140`): local `pixelsPerSecond` state (`DEFAULT 80`, clamp `MIN 20`–`MAX 400`), driven by **Ctrl/Cmd + wheel** (`handleWheel`, factor 0.9/1.1). Plain wheel over the timeline does nothing. This is **timeline time-scale**, unrelated to canvas viewport zoom.
- **Canvas render area** (`Canvas.tsx:1140-1183`): outer `div.flex-1.flex.items-center.justify-center.bg-gray-950.p-4.overflow-hidden` (1141) → inner `div.relative.max-w-full.max-h-full` with `aspect-ratio` (1142) → stacked render `<canvas>` + overlay `<canvas>` (both `w-full h-full`), plus the tooltip (1159) and the Frame/Live toggle button (1170-1180). The outer container **already clips** (`overflow-hidden`), so a scaled inner wrapper is clipped for free. **No `onWheel` handler on the canvas today** — the wheel is unbound over the render area.
- **Hit-testing is rect-relative** (`Canvas.tsx:98-107`): `clientToNorm` = `(e.clientX - rect.left) / rect.width`, with `rect = canvas.getBoundingClientRect()`. This reads the **live, post-CSS-transform geometry** of the overlay canvas, so any uniform scale + translate on an ancestor is automatically absorbed — normalized coords stay exact (see D-viewport-math below). The window-level drag handler (for dragging outside the canvas) uses the same `getBoundingClientRect` path, so it stays correct too.
- **Backing store = raw project dims, no DPR handling** (CLAUDE.md "rough edges"; `useCanvasRenderer`): the render canvas buffer is the fixed project resolution and CSS letterboxes it. Consequence: CSS-scaling the element **beyond fit** upscales a fixed raster → soft/blurry at high viewport zoom (acceptable for v1; see Open Questions).
- **View-state precedent**: `cameraView: 'frame'|'live'` (`App.tsx:34`) and `pixelsPerSecond`/`addedTopLane`/`addedBottomLane` (`Timeline.tsx:99-104`) are all **ephemeral `useState` — not persisted, not in undo**. `config.ts persistProject` defaults **false**; there is no view-state persistence layer today. New state in this spec follows the same ephemeral pattern.

## Requirements

### A. Bounded timeline height + internal vertical scroll (root-cause fix)

- **A1**: The Timeline occupies a **bounded height** that does not grow with lane count. Adding lanes must **never** shrink the render area. The Canvas's `flex-1` keeps whatever vertical space the timeline does not claim.
- **A2**: When lanes exceed the visible timeline height, the **object-lane stack scrolls vertically inside the timeline** (`overflow-y: auto`), instead of the timeline growing. Horizontal time-scroll (existing `overflow-x-auto`) is preserved and independent.
- **A3**: The **time-ruler stays pinned to the top** and the **Camera track stays pinned below the ruler** while the object lanes scroll under them (frozen header). The **lane gutter** (add/remove-lane controls) stays horizontally frozen and vertically aligned with its lane row (frozen first column) — the gutter and its lane bars scroll together, never desyncing.
- **A4**: The bounded height has a sensible **default** (shows the ruler + Camera track + roughly 3–4 lanes so the timeline reads as populated on a fresh project) and a **minimum** (never smaller than ruler + Camera track + 1 lane, so the timeline is always usable). The default may be expressed as a fraction of window height, clamped to a px min/max. Exact numbers in Implementation Notes.
- **A5**: A subtle scroll affordance (native scrollbar or a thin custom one) indicates more lanes exist above/below the fold. Scrolling must not hijack page/timeline horizontal scroll.

### B. Resizable render/timeline split + collapse

- **B1**: A **draggable horizontal splitter** sits on the border between the main content (render) and the timeline. Dragging **up** grows the timeline (more lanes visible) and shrinks the render; dragging **down** does the reverse. Cursor = `row-resize` on hover.
- **B2**: The dragged timeline height is **clamped**: min = ruler + Camera track + 1 lane (≈150px); max = leave at least a usable render area (e.g. window height − header − ~200px). Within the clamp, the render fills the remainder automatically (it stays `flex-1`).
- **B3**: A **collapse/expand toggle** (chevron in the timeline header/gutter corner) collapses the timeline to a thin strip (ruler + playhead + Camera track, or fully to a slim bar) to reclaim the render, and restores the prior height on expand. State survives within the session.
- **B4**: The splitter height, collapse state, and B-related state are **ephemeral view state** (like `cameraView`) — not written to the project, not part of undo. (Persisting to `localStorage` across refreshes is an Open Question, deferred by default.)
- **B5**: The splitter/collapse never lets either region hit 0 or overflow the window; on window resize the split re-clamps so neither region becomes unusable.

### C. Editor viewport zoom + pan (canvas viewer)

- **C1**: Introduce an **editor-only viewport transform** over the render area: a `scale` (zoom) and `pan` (x/y offset) applied to the on-screen canvas **only**. It **does not** modify object data, the camera (spec 13), or export output. `100% = fit-to-window` (today's letterbox baseline); zooming in magnifies; the transform is purely how close the editor is looking.
- **C2**: **Plain mouse-wheel over the render area zooms to the cursor** — the canvas point under the cursor stays fixed as scale changes (standard zoom-to-cursor). Per-notch factor consistent with the timeline (≈1.1). Plain wheel is bound to viewport zoom in the render area (nothing else uses it there); the timeline keeps Ctrl+wheel for its time-zoom. *(Decided 2026-07-09.)*
- **C3**: **Pan** when zoomed in via an explicit gesture that does not conflict with object editing: **Space+drag** and/or **middle-mouse-drag** (Figma/Photoshop convention). Panning is clamped so the canvas can't be dragged entirely out of view. Plain left-drag on the overlay keeps its current meaning (select/move objects, marquee, draw).
- **C4**: **Zoom range** clamped (recommend **25%–400%** relative to fit; extensible later). A **Fit / reset** action returns to `scale = 1, pan = 0`: via a Fit button (D1), a shortcut, and/or double-click on empty canvas background.
- **C5**: The viewport transform is applied so that **the overlay (selection box, handles, framing rect, arrow rubber-band) scales in lockstep with the render canvas** — both live under the same transform — and **hit-testing/overlay math needs no changes** (guaranteed by the `getBoundingClientRect`-relative mapping; see D-viewport-math). The Frame/Live toggle button and tooltip must **not** be scaled by the viewport transform (they sit outside the transformed layer).
- **C6**: Viewport zoom composes cleanly with **Frame and Live** camera views and with playback — it simply magnifies whatever the render canvas is showing. It is **orthogonal** to the amber camera framing rect and must be visually distinguishable from it (the camera rect/scrim is a scene-space overlay; viewport zoom magnifies the whole viewer including that overlay).
- **C7**: **Export is unaffected** — `ffmpegExport.ts` renders through its own offscreen canvas via `renderFrame`, so the on-screen CSS transform can't leak into output. (Non-regression: verify export pixels are identical with the viewport zoomed in.)
- **C8**: Editor zoom/pan is **ephemeral view state** (not persisted, not undo). On **aspect-ratio change** (`AspectRatioSelector`) the viewport resets to Fit to avoid stale offsets.

### D. Zoom controls / discoverability

- **D1**: A small **viewport-zoom control cluster** in a canvas corner: `−  [ 100% ]  +  Fit`. The `%` shows current zoom (relative to fit); `+`/`−` step; clicking `%` may open preset steps (50 / 100 / 200%); `Fit` resets (C4). Styled to match the existing corner button (`Canvas.tsx:1170-1180`) so the render area's controls read as one system. This makes zoom discoverable rather than wheel-only.
- **D2**: The control cluster and the Frame/Live toggle must not overlap/collide; lay them out as a coherent corner toolbar.

### E. (Optional / lower priority) compact + vertical timeline zoom

- **E1** *(optional)*: A **compact lane** toggle reducing `LANE_HEIGHT` (~32→~18px) so more lanes fit before scrolling — the vertical analog of horizontal time-zoom. Alternatively a **vertical timeline zoom** (modifier+wheel over the gutter) adjusting lane height across a clamped range. Lower priority because **A** already removes the squish; include only if cheap. Waveform/clip visuals must remain legible at the smaller height.

### Non-regression / correctness

- **N1**: With a small project (few lanes), the timeline and render look and behave as today (default height leaves the render as large as, or larger than, before).
- **N2**: Existing timeline interactions are unaffected: horizontal time-zoom (Ctrl+wheel), playhead scrub, clip drag/resize/trim/split, keyframe-diamond drag, Camera-track drag, lane add/remove.
- **N3**: All existing canvas interactions work at any viewport zoom/pan: select, move, resize, rotate, arrow/freehand draw, camera framing-rect edit, the window-level out-of-canvas drag path, and double-click-to-edit-text — because hit-testing is rect-relative (C5).
- **N4**: Export output is byte-identical regardless of on-screen viewport zoom/pan, splitter height, or collapse state (C7).
- **N5**: No changes to `Project`, `TimelineObject`, `CameraZoom`, `ProjectAction`, the `useProject` reducer, `renderer.ts`, or the export pipeline. `npx tsc -b` stays green.

### Decided against (traceability)

- **~~Auto-zoom the render out when lanes are added~~** (user's original idea #2): rejected. It couples the render viewport to lane count, making the render jump on an unrelated action, and it's a symptom-patch. **A (bounded timeline + internal scroll)** fixes the root cause so the render never needs to react to lane count. Superseded.

## Technical Considerations

**This feature is almost entirely view state. It introduces NO new persistent types and changes NO data-model types.** The existing model (`src/types.ts` `TimelineObject`, `Project`, `CameraZoom`, `ProjectAction`) is untouched. The "types" here are the shapes of new ephemeral React state.

### New view-state (ephemeral `useState`, mirrors `cameraView`)

Owned in `App.tsx` where it must be to arbitrate the render/timeline split, or extracted into a small hook (e.g. `useViewport`). Proposed shapes:

```ts
// Editor viewport (canvas viewer) — NOT persisted, NOT undo. 100% = fit-to-window.
type ViewportState = {
  scale: number   // 1 = fit; clamped e.g. [0.25, 4]
  panX: number    // px offset applied after scale, clamped so canvas stays partly on-screen
  panY: number
}
const IDENTITY_VIEWPORT: ViewportState = { scale: 1, panX: 0, panY: 0 }

// Render/timeline split — NOT persisted, NOT undo.
type TimelineLayout = {
  height: number | null   // px; null = use computed default
  collapsed: boolean
}
```

- **Ownership**: the **split height/collapse must live in `App.tsx`** (it governs the Timeline sibling's box, which in turn frees space for the Canvas `flex-1`). App renders the splitter handle between `<Canvas>`/main-content and `<Timeline>`, and passes the resolved height (or a `collapsed` flag) down so the Timeline renders within a bounded box. The Timeline internally handles its own vertical scroll + pinned header/gutter.
- **Viewport zoom** may live in `App.tsx` and be passed to `<Canvas>`, or be encapsulated in `Canvas.tsx`/a `useViewport` hook. It only needs to reset on aspect-ratio change (which App drives via `AspectRatioSelector` → `dispatch`), so App-level or a hook subscribed to `width/height` both work.

### D-viewport-math — why hit-testing needs no changes

`clientToNorm` (`Canvas.tsx:98-107`) computes `nx = (clientX − rect.left) / rect.width` from `overlayCanvas.getBoundingClientRect()`. `getBoundingClientRect()` returns the element's box **after** all ancestor CSS transforms. For a **pure uniform scale + translate** (no rotation/skew), the transformed box is still an axis-aligned rectangle, so `rect.left`/`rect.width` shift/scale exactly with the transform and the normalized ratio is **invariant**. Therefore: apply `transform: translate(panX, panY) scale(scale)` (with an appropriate `transform-origin`) to a wrapper that contains **both** canvases, and every existing hit-test, drag, handle, and overlay-draw path keeps working with **zero math changes**. This is the same property spec 13 relied on to avoid an inverse camera transform.

- **Where to apply the transform**: NOT on `Canvas.tsx:1142` `div.relative` as-is, because it also contains the tooltip and the Frame/Live button (they'd scale/move). Restructure to an **inner transform layer** wrapping only the two `<canvas>` elements; keep tooltip + toggle button + the new zoom cluster as non-transformed siblings within `div.relative`. The outer `overflow-hidden` (`Canvas.tsx:1141`) clips the zoomed/panned layer.
- **Zoom-to-cursor**: on wheel, compute the new scale, then adjust `panX/panY` so the scene point under the cursor is stationary (standard `newPan = cursor − (cursor − oldPan) * (newScale/oldScale)`), or set `transform-origin` to the cursor and fold into pan. Clamp pan so the canvas can't leave the viewport entirely.
- **Wheel + preventDefault**: React's `onWheel` may be passive; to reliably `preventDefault` the page/scroll, attach a **non-passive native wheel listener** via `ref` + `useEffect` on the render container (the timeline's `handleWheel` uses React `onWheel` + `preventDefault` under `ctrlKey` and works, but a native non-passive listener is the safe pattern for plain-wheel zoom).
- **Blur at high zoom**: backing store is fixed project resolution (no DPR). CSS-scaling >100% upscales a fixed raster → soft. Accept for v1; a follow-up could raise the backing-store resolution or add DPR-awareness (ties into the standing "No DPR handling" rough edge). Note in Open Questions.
- **Handle visual size**: overlay handles are drawn in canvas-pixel space, so they scale with viewport zoom (bigger when zoomed in, smaller out). Hit-testing still works (rect-relative). Optional later polish: counter-scale handle sizes by `1/scale` so they stay a constant screen size. Not required for v1.

### A/B layout — the frozen-header/frozen-column refactor

The current Timeline is a two-column flex row where the gutter and scroll area are **siblings** (so the gutter can't scroll with the lanes vertically). To get A3 (pinned ruler + Camera track, frozen gutter, scrolling lanes) cleanly:

- **Recommended pattern**: a **single scroll container** (`overflow-x-auto overflow-y-auto`, bounded height) holding a grid/relative layout where:
  - the **ruler + Camera track** use `position: sticky; top: 0` (frozen header during vertical scroll),
  - the **gutter** column uses `position: sticky; left: 0` (frozen first column during horizontal scroll),
  - the **top-left corner** (gutter ∩ header) is sticky on both axes with the highest z-index.
  This is the standard spreadsheet frozen-row+column technique and avoids scroll-sync JS. It merges today's two-column mirrored structure (`Timeline.tsx:347-407`, and the manual content-column spacers at 548/873 can go away). Alternatively, keep two vertical regions (fixed header band + scrolling body) and **sync horizontal scroll** between ruler and lanes via JS — more moving parts; not recommended.
- The **playhead** currently spans the full timeline height (`Timeline.tsx:875-880`, `height:100%`). Under a scrolling lane area it must still visually span ruler → lanes; ensure it's drawn relative to the scroll content (or split into a header segment + a body segment) so it doesn't detach when scrolled.
- **Add-lane affordances** (`Timeline.tsx:362-401`): the add-above/add-below buttons currently bracket the lane stack in the gutter. Simplest: let them scroll as the top/bottom of the scrolling lane stack. Minor; finalize in implementation.
- **Height source**: App sets the Timeline container height (default/dragged/collapsed). Timeline's inner scroll area = that height − pinned header. `minHeight: 120` (`Timeline.tsx:346`) is replaced by the clamped bounded height.

### Naming to keep the four "zooms" distinct (UX)

The app will now have four distinct "zoom" concepts; the UI copy/tooltips should keep them separate:
1. **Camera zoom** (spec 13) — a real render effect, exported (amber framing rect / Live view).
2. **Object resize** — scaling an object's bbox.
3. **Timeline time-zoom** — horizontal `pixelsPerSecond` (Ctrl+wheel on timeline).
4. **Viewport zoom** (this spec) — editor-only magnification of the canvas viewer, never exported.

Recommend labelling #4 as "Zoom" / "%" on the canvas viewer (Figma-style) and never near the amber camera controls.

## Related Systems and Tasks

- **CLAUDE.md** → "Rendering pipeline" (two-canvas render+overlay, no DPR), "Camera / zooms" (Frame vs Live, `cameraView`), "Gotchas / current rough edges" ("60Hz re-render", "No DPR handling", "Overlay must mirror render transforms").
- **Spec 13** (`SPECS/13-camera-zoom.md`) — the camera; establishes the `getBoundingClientRect`-relative, no-inverse-transform property this spec reuses, and the Frame/Live corner toggle this spec sits beside.
- **Spec 14** (`SPECS/14-video-sequencing.md`, in progress on this branch) — adds trim/split/hide on clips; increases lane/clip density, which makes the squish worse and this spec more valuable.
- **Spec 09** (`SPECS/09-in-video-perf.md`) — notes the 60Hz `globalTime` re-render of App→Canvas→Timeline; viewport zoom should avoid adding per-frame React work (CSS transform is cheap and off the render loop).
- Files in play: `src/components/App.tsx` (split ownership, splitter, viewport reset on aspect change), `src/components/Canvas.tsx` (viewport transform layer, wheel/pan, zoom cluster), `src/components/Timeline.tsx` (bounded height, pinned header/gutter, vertical scroll). No `src/lib/*`, `src/hooks/useProject.ts`, or export files change (except possibly a new `src/hooks/useViewport.ts`).

## Open Questions

*All resolved 2026-07-09.*

1. ~~**Wheel binding for viewport zoom**~~ — **RESOLVED: plain wheel = zoom** over the render area; timeline keeps Ctrl+wheel for time-zoom (C2).
2. **Zoom-out below fit?** — **RESOLVED: allow** `scale` down to ~0.25 (shrink below fit for breathing room); cheap once the transform exists (C4 range 25%–400%).
3. ~~**Persist view state across refresh?**~~ — **RESOLVED: ephemeral for v1** (not persisted, not undo), consistent with `cameraView` + `persistProject: false` (B4, C8).
4. **Default & max timeline height** — **RESOLVED: fraction-of-window clamped to px**: default ~35% of window height, min ~150px (ruler + Camera track + 1 lane), max ≈ window − header − ~200px so the render stays usable (A4, B2).
5. **High-zoom blur** — **RESOLVED: accept the soft raster at >100% for v1**; raising backing-store resolution / DPR-awareness is a follow-up (ties into the standing "No DPR handling" rough edge).
6. **Scope of E (compact/vertical-zoom lanes)** — **RESOLVED: deferred** (optional); A removes the squish, so E ships only if trivial. Core scope is A+B+C+D.

## Acceptance Criteria

- Adding lanes/clips **never shrinks the render area**; beyond the timeline's bounded height, lanes scroll vertically inside the timeline with the ruler + Camera track pinned and the gutter aligned (A1–A5).
- A draggable splitter resizes the render/timeline split within clamps, and a collapse toggle reclaims/restores the timeline; both are session view state, not persisted to the project or undo (B1–B5).
- Mouse-wheel over the render area zooms to the cursor; the canvas can be panned when zoomed; a Fit action resets; zoom is clamped (C1–C4).
- At any viewport zoom/pan, **all** existing canvas interactions still work (select/move/resize/rotate, arrow/freehand draw, camera framing-rect edit, out-of-canvas drag, double-click text) with no hit-test drift (C5, N3).
- A canvas-corner zoom cluster (`− % + Fit`) shows/controls the zoom and coexists with the Frame/Live toggle (D1–D2).
- **Export output is byte-identical** regardless of on-screen viewport zoom/pan/split/collapse (C7, N4).
- No data-model/reducer/renderer/export changes; `npx tsc -b` is green (N5).
- Small projects look/behave as before, with the render at least as large as today at default split (N1).

## Implementation Notes

- **Suggested build order** (each independently shippable):
  1. **A + B (layout, self-contained, no interaction risk):** bound the Timeline height (App owns `timelineHeight`/`collapsed`), refactor the Timeline to the single dual-scroll container with sticky ruler + Camera track (frozen header) and sticky gutter (frozen column), fix the playhead to span correctly, add the splitter + collapse. Kills the squish. Pure layout/view-state; no undo/model impact.
  2. **C + D (viewport zoom/pan):** wrap the two canvases in a transform layer inside `Canvas.tsx:1142`, move the toggle button/tooltip out of the transformed layer, add a non-passive wheel listener (zoom-to-cursor), Space/middle-mouse pan with clamping, the corner zoom cluster, Fit reset, and reset-on-aspect-change. Verify N3/N4 by exercising every canvas gesture zoomed in and diffing an export.
- **Reuse**: match the corner-button styling at `Canvas.tsx:1170-1180` for the zoom cluster; reuse the wheel-factor (1.1) and clamp pattern from `Timeline.tsx:135-138`; follow the ephemeral-`useState` view-state pattern of `cameraView` (`App.tsx:34`).
- **Watch**: (a) don't regress the sticky ruler/Camera-track/playhead when introducing vertical scroll; (b) keep the transform a pure uniform scale + translate (no rotation) so `clientToNorm` stays valid; (c) `preventDefault` the wheel via a non-passive native listener to stop page scroll; (d) re-clamp split + pan on window resize; (e) reset viewport to Fit on aspect-ratio change.
- **Verify (per project policy — static checks only, then hand the user a checklist):** `npx tsc -b` green; then user-side: add 10+ lanes → render stays put, lanes scroll, ruler/Camera pinned; drag splitter + collapse; wheel-zoom to cursor + pan + Fit; run every canvas gesture at 200% zoom; export at 200% zoom and confirm output unchanged.

## Notes / discussion decisions

- User's original three ideas map to: #1 → **C** (kept, refined to zoom-to-cursor + explicit pan), #3 → **A** (kept, this is the root-cause fix), #2 (auto-zoom render on lane add) → **rejected**, superseded by A (see "Decided against").
- Additional ideas drawn from Premiere/Resolve/CapCut/Figma conventions: resizable panel splitter + collapse (**B**), discoverable zoom % cluster with Fit (**D**), and optional compact/vertical-zoom lanes (**E**).

---
*This specification is ready for implementation. Use `/task 16-ui-improvements` to begin development.*
