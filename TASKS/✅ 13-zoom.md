# 13-zoom (Camera Zoom)

**Status**: Complete

## Overview

Add **camera zooms** — punch the "camera" in on a region of the canvas for a stretch of time, then pull back out (à la Screen Studio). The camera is a **single global `ctx.translate/scale` transform in `renderFrame`**, applied in front of the object loop. Because object coords are normalized 0–1, it composes over every object for free and works **identically in preview and export** (both share `renderFrame`).

Full spec: [SPECS/13-camera-zoom.md](../SPECS/13-camera-zoom.md).

Two shaping decisions:
1. **Authoring un-zoomed (Frame view), playback/export zoomed (Live view).** During authoring the canvas stays full-frame; the zoom shows as a bright framing rectangle + grey scrim. A Live/WYSIWYG toggle (and every export) applies the real transform. → never need to invert the camera transform for hit-testing in v1.
2. **Camera = discrete "zooms", not raw keyframe tracks.** Each zoom is `{x,y,scale}` + timing (`startTime, transitionIn, hold, transitionOut, easing`); `resolveCamera` compiles the list into an effective pose per time.

Thin layer on the spec-12 easing engine (reuses `ease`/`lerp`/`clamp01` from `src/lib/easing.ts`), but NOT the whole-pose `Keyframe[]` machinery.

## Task Context

- **Verify with `npx tsc -b`** between phases. Do NOT run dev server / browser automation — hand the user a "click X, look for Y" checklist (verify skill).
- `renderFrame` (`src/lib/renderer.ts:22`) is the single shared compositor. Wrap the object loop (`renderer.ts:43-69`) in `ctx.save(); <camera transform>; …; ctx.restore()` after the background fill.
- Overlay is a **separate canvas** (`Canvas.tsx`), `drawOverlay` paints in pixel space and owns mouse events — this is where the framing rect + grey scrim go. NOT part of `renderFrame`.
- Easing engine: `ease(kind,u)`, `lerp`, `clamp01` in `src/lib/easing.ts`. `EasingKind` in `types.ts:44`.
- Reducer/undo: `useProject.ts` — transient/commit pattern (`UPDATE_OBJECT_TRANSIENT` → `COMMIT_TRANSIENT`) for continuous gestures = one undo entry.
- Selection today is `selectedObjectId: string | null` in `App.tsx`. Zooms aren't `TimelineObject`s → add parallel `selectedZoomId` with mutual exclusion.

### Confirmed decisions (spec D1–D5 + open-Q recommendations, going with defaults)

- **Default new zoom:** `scale: 2`, `transitionIn: 0.6`, `hold: 2`, `transitionOut: 0.6`, `easing: 'easeInOutCubic'`, `x: 0.5`, `y: 0.5`.
- **Toolbar cluster label:** "Animations".
- **Selection state:** separate `selectedZoomId` (not unified selection object).
- **Retiming/overlap:** keep sorted by `startTime`, allow adjacency, resolver handles it (no hard blocking).
- **Strokes/fonts scale with zoom** in Live view (real camera, everything scales).
- **`scale ≥ 1` only** (no zoom-out / pan beyond frame in v1).

## Blockers/Issues

None currently.

## TODO

**Phase 1 — Types + resolver + static transform** ✅
[X] Add `CameraState`, `CameraZoom`, `IDENTITY_CAMERA` to `types.ts`; `Project.zooms?`; zoom `ProjectAction`s; `createCameraZoom` factory
[X] New `src/lib/camera.ts`: `resolveCamera(zooms, t)` (governing-window + `fromPose` chaining) + `cameraFrameRect`/`cameraFromFrameRect`/`isIdentityCamera` helpers
[X] `renderFrame`: optional `camera?: CameraState` (via `EditorOptions.camera`) + transform wrap (identity → skipped → unchanged)
[X] Resolver proven: 23/23 assertions pass in standalone node check (envelope, A→B chain, gap→pull-back, mid-out chain, unsorted, zero-transition). tsc green.

**Phase 2 — Reducer + create flow + panel editor** ✅
[X] Zoom reducer cases in `useProject.ts` (`ADD_ZOOM`/`UPDATE_ZOOM`/`UPDATE_ZOOM_TRANSIENT`/`REMOVE_ZOOM` + reuse `COMMIT_TRANSIENT`)
[X] `selectedZoomId` state + object/zoom mutual exclusion in `App.tsx` (+ Delete/Esc handle zooms)
[X] `+ Zoom` CTA in new "Animations" cluster (`AnnotationTools.tsx`), re-grouped into Assets/Annotations/Animations; wired like `+ Text`
[X] Camera/Zoom editor (`ZoomEditor`) in `PropertiesPanel.tsx` when a zoom is selected (`{x,y,scale}` + timing + easing + delete + jump-to-start)

**Phase 3 — Frame view overlay + Live toggle** ✅
[X] Framing rectangle + grey scrim in `drawOverlay` (selected → editable target rect + handles; else → read-only resolved rect that animates with the playhead)
[X] Frame/Live toggle (`cameraView` view state, not persisted/undo) — corner button + `V` shortcut
[X] Thread `camera` through `useCanvasRenderer` via `EditorOptions.camera` (Live → resolveCamera, Frame → identity)

**Phase 4 — On-canvas authoring** ✅ (draw-to-create deferred, optional)
[X] Select + move/resize selected zoom's framing rect via transient→commit (move = shift focal, corner = scale about fixed focal; focal clamped in-bounds)
[X] Click an active resolved framing rect (nothing selected) to select its governing zoom
[ ] (Optional) draw-rectangle-to-create (aspect-fit → `{x,y,scale}`) — deferred, not required

**Phase 5 — Timeline Camera track** ✅
[X] Pinned Camera track in `Timeline.tsx` from `project.zooms` (own row under the ruler + ⛶ gutter label); amber envelope bars with transition-in/out ramp shading
[X] Drag-to-retime (startTime) + resize (left/right adjust `hold`, opposite edge anchored) + click-to-select — all transient→commit (one undo per gesture)
[X] Empty camera-track / lane click deselects zoom; object↔zoom mutual exclusion preserved

**Phase 6 — Export wiring** ✅
[X] Pass `resolveCamera(project.zooms, t)` per frame in `ffmpegExport.ts` (WebCodecs + MediaRecorder) + `exportWorker.ts`
[X] Persistence (`projectStorage.ts`) round-trips `zooms` automatically (whole-project JSON — verified, no change needed)
[ ] Confirm exported push-in matches Live preview (needs user browser test)

## Work Log

[2026-07-09] Task created from SPECS/13-camera-zoom.md. Grounded in types.ts, easing.ts, renderer.ts.

[2026-07-09] Phase 1 complete — camera types + resolver + render transform.
- Files: src/types.ts (CameraState/CameraZoom/IDENTITY_CAMERA/Project.zooms?/zoom actions/createCameraZoom), src/lib/camera.ts (new), src/lib/renderer.ts (EditorOptions.camera + transform wrap)
- Resolver verified with standalone node script (scratchpad/verify-camera.mjs, linear-ease stub): 23/23 pass covering single envelope, A→B chaining (no pull-back), gap→pull-back, mid-ease-out chaining, unsorted input, zero-transitionIn snap. tsc -b green.

[2026-07-09] Phases 2, 3, 4, 6 complete — create flow, panel editor, Frame/Live overlay + toggle, on-canvas authoring, export wiring. Full build green.
- src/hooks/useProject.ts: ADD_ZOOM/UPDATE_ZOOM/UPDATE_ZOOM_TRANSIENT/REMOVE_ZOOM cases (transient mirrors object pattern).
- src/components/AnnotationTools.tsx: re-grouped toolbar into Assets/Annotations/Animations labelled clusters; + Zoom CTA.
- src/components/App.tsx: selectedZoomId + cameraView state, handleCreateZoom (default zoom at playhead → select → Frame view), handleSelectZoom, toggleCameraView, mutual exclusion, Delete/Esc + V shortcut, threaded zoom props into Canvas + PropertiesPanel.
- src/components/PropertiesPanel.tsx: ZoomEditor (Focus x/y/scale, Timing start/in/hold/out, Motion easing, span readout, jump-to-start, delete); early branch when zoom selected.
- src/components/Canvas.tsx: liveCamera → EditorOptions.camera; drawOverlay camera framing rect + grey scrim (scrim fill + clearRect punch-out); selected-zoom drag/resize via UPDATE_ZOOM_TRANSIENT→COMMIT_TRANSIENT (zoom-move/zoom-resize DragState); zoom hit-testing + hover cursors; click-to-select governing zoom; Frame/Live corner toggle button. Object editing suppressed in Live view.
- src/lib/camera.ts: added zoomEnvelope + governingZoomAt helpers.
- src/lib/ffmpegExport.ts (both WebCodecs + MediaRecorder paths) + src/lib/exportWorker.ts: pass resolveCamera(project.zooms, t) per frame.
- Persistence unchanged (whole-project JSON already round-trips zooms).
- Open Qs resolved with spec defaults (scale 2 / 0.6 / 2 / 0.6 / easeInOutCubic; "Animations" label; separate selectedZoomId).

[2026-07-09] Phase 5 complete — Timeline Camera track. All phases done (pending user browser validation).
- src/components/Timeline.tsx: pinned Camera track (its own CAMERA_TRACK_HEIGHT row under the ruler in both the gutter — ⛶ label — and the scroll area). Renders project.zooms as amber envelope bars; transition-in/out shown as dark gradient ramps at each end, hold = solid middle; label shows scale ×. Zoom DragState variants (zoom-move / zoom-resize-left / zoom-resize-right) → UPDATE_ZOOM_TRANSIENT + COMMIT_TRANSIENT (one undo/gesture). Resize adjusts `hold` anchored at the opposite edge; left-resize also moves startTime with a clamp so hold never goes negative. Click a bar → onSelectZoom; empty track/lane click → deselect + seek.
- src/components/App.tsx: threaded zooms / selectedZoomId / onSelectZoom into Timeline.
- src/lib/camera.ts zoomEnvelope reused for bar width. tsc + full vite build green; no new lint errors (4 pre-existing React-Compiler memoization errors unchanged).
