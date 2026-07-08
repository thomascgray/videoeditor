# rotation-fixes

**Status**: In Progress

## Overview

After rotating an object on the canvas, the rotate and resize handles can no
longer be clicked reliably. The interactive hit-regions drift away from where
the handles are visually drawn, and the drift grows with the rotation angle.

## Task Context

- Objects store transform as **normalized** coords: `x, y, width, height` are
  0–1 relative to the canvas; `rotation` is radians around the bbox center
  (see [src/types.ts](../src/types.ts) `TimelineObject`).
- All interaction/hit-testing code lives in
  [src/components/Canvas.tsx](../src/components/Canvas.tsx).
- The real render happens in [src/lib/renderer.ts](../src/lib/renderer.ts).

### Root cause (identified 2026-07-08)

Rotated objects are **drawn in pixel space** but **hit-tested in normalized
space**:

- Drawing rotates in pixel space:
  - renderer: `translate(cx_px, cy_px); rotate(θ); translate(-cx_px, -cy_px)`
    ([renderer.ts:93-98](../src/lib/renderer.ts#L93-L98))
  - overlay handles: same, in `drawOverlay`
    ([Canvas.tsx:454-458](../src/components/Canvas.tsx#L454-L458))
- Hit-testing rotates in normalized space via `rotatePoint` /
  `normToObjectLocal` ([Canvas.tsx:80-104](../src/components/Canvas.tsx#L80-L104)),
  treating the x and y axes as isotropic.

Because the canvas is non-square (e.g. 16:9), rotation does **not** commute with
the non-uniform normalized→pixel scaling. So the two rotations diverge and the
handle hit-regions no longer line up with the drawn handles. This affects:

1. `hitTestHandles` / `hitTestObject` — can't click handles/body after rotation
   (the reported bug).
2. `computeResize` — projects the drag delta onto the object's local axes and
   applies the anchor correction in normalized space, so resizing a rotated
   object on a non-square canvas is skewed (latent bug, same root cause).
3. `normToObjectBbox` — placing arrow/freehand points on a rotated object is
   likewise skewed (latent).

### Fix approach

Do all rotation math in **aspect-corrected (pixel) space** so it matches how
objects are drawn. Introduce one helper that rotates a normalized point about a
normalized center by converting the delta to pixels, rotating, then converting
back:

```
rotatePointAspect(px, py, cx, cy, angle, W, H):
  dxPx = (px-cx)*W; dyPx = (py-cy)*H
  rotate (dxPx,dyPx) by angle
  return { x: cx + rxPx/W, y: cy + ryPx/H }
```

Route `normToObjectLocal` (angle = -rotation) and the `computeResize` anchor
correction (angle = +rotation) through it, and add the H/W and W/H aspect
factors to the resize delta projection. Thread `canvasW, canvasH` through the
hit-test/resize helpers (all callers already have `width`/`height` in scope).

## Blockers/Issues

None currently.

## TODO

[X] Add an aspect-aware rotation helper (pixel-space rotation over normalized coords)
[X] Fix `normToObjectLocal` / `normToObjectBbox` / `hitTestObject` / `hitTestHandles` to rotate in pixel space (fixes handle clicking — the reported bug)
[X] Fix `computeResize` delta projection + anchor correction to be aspect-aware
[X] Verify: numerically confirmed a click on the drawn handle now registers a hit (0px off) where the old code missed by 74px on a 16:9 canvas
[X] Typecheck passes (lint errors present are all pre-existing/unrelated)

## Work Log

[2026-07-08] Diagnosed root cause: rotated objects drawn in pixel space but
hit-tested in normalized space; the two rotations diverge on non-square canvases,
so handle hit-regions drift from the drawn handles.

- Files inspected: src/components/Canvas.tsx, src/lib/renderer.ts, src/types.ts

[2026-07-08] Fixed the coordinate-space mismatch. Replaced normalized-space
`rotatePoint` with `rotatePointAspect`, which rotates in pixel space (converts
the normalized delta to pixels, rotates, converts back) so hit-testing matches
how objects are actually drawn. Threaded `canvasW`/`canvasH` through
`normToObjectLocal`, `normToObjectBbox`, `hitTestObject`, `hitTestHandles`, and
`computeResize`. `computeResize` also now applies the H/W and W/H aspect factors
to the local delta projection and rotates the anchor correction via
`rotatePointAspect`. Updated the affected `useCallback`/`useEffect` dep arrays.
Verified numerically (16:9, 0.6rad): click on drawn 'se' handle → local exactly
(0.6, 0.5), 0px off (HIT); old code was 74.2px off (MISS, hit radius is 14px).

- Files modified: src/components/Canvas.tsx
