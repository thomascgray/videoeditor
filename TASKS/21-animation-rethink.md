# 21-animation-rethink

**Status**: In Progress

## Overview

Rework the motion vocabulary of the animation system so it's legible and expressive. Three coupled changes riding on the spec-12 easing engine (`ease`/`lerp`) and spec-13 camera:

1. **Curated easing picker + new `instant` curve** — replace the 9 near-duplicate easings with 7 maximally-distinct presets, add `instant` (hard-cut), and show a live preview of the selected curve.
2. **Per-keyframe "animate over" lead-in** — an optional `leadIn` so the tween into a keyframe occupies only the last *d* seconds (holds the previous pose before then). Enables "hold 10s, then push at the end".
3. **Snappy-by-default new keyframes** — new keyframes seed `leadIn = min(0.8, gapToPrev)`; legacy (no leadIn) keyframes still fill the gap (bit-identical back-compat).

Applies uniformly to object keyframes (`keyframes.ts`) and camera-zoom keyframes (`camera.ts`); the picker also feeds enter/exit transitions and the zoom in/out ramp.

Spec: [SPECS/21-animation-rethink.md](../SPECS/21-animation-rethink.md)

## Task Context

- **EasingKind** `src/types.ts:54-59`; `ease()` switch `src/lib/easing.ts:42-55`.
- **Central easing list** `EASINGS`/`EASING_LABELS` in `src/components/propertyControls.tsx:15-31`, consumed by FOUR+ raw `<select>` sites:
  1. `TransitionFields` (enter/exit) `propertyControls.tsx:150-158` — shared by `PropertiesPanel` + `ContextToolbar`.
  2. Object keyframe Motion `PropertiesPanel.tsx:310-318`.
  3. Zoom ramp Motion `PropertiesPanel.tsx:680-687` AND `ContextToolbar.tsx:143-149`.
  4. Zoom keyframe Motion `PropertiesPanel.tsx:738-746`.
- **Interpolation**: `poseAt` `keyframes.ts:66-91`; `zoomPoseAt` `camera.ts:171-194` — replace per-segment body with the shared lead-in formula.
- **Keyframe creation (4 sites, seed default leadIn)**: `addKeyframeAt` `keyframes.ts:215-224`, `editPose` insert branch `keyframes.ts:195-202`, `addZoomKeyframeAt` `camera.ts:248-257`, `editZoomPose` insert branch `camera.ts:232-237`.
- **Timeline diamonds/ramps**: object diamonds `Timeline.tsx:955-988`; zoom diamonds `Timeline.tsx:701-733`; gradient ramp pattern `Timeline.tsx:653-666` / `888-900`. `timeToX(t) = t * pixelsPerSecond` (linear through origin) — container offset handles startTime.
- **Verify**: static checks only (`npx tsc -b`) — user tests in browser. See `.claude/skills/verify`.

### Shared lead-in formula (both `poseAt` and `zoomPoseAt`)
```ts
const animStart = b.leadIn == null ? ta : Math.max(ta, tb - b.leadIn)
if (t < animStart) return a.pose
const span = tb - animStart
const u = span > 1e-9 ? (t - animStart) / span : 1
return lerp(a.pose, b.pose, ease(b.easing, u))
```

## Blockers/Issues

None currently.

## TODO

[X] Types: `EasingKind` = 7 presets (add `instant`, remove quads); add `leadIn?` to `Keyframe` + `CameraKeyframe`
[X] `ease()`: add `instant` case, remove quad cases
[X] `keyframes.ts`: repoint `defaultTransitionEasing` fades to cubic; add `DEFAULT_LEAD_IN`; `seedLeadIn` helper; lead-in formula in `poseAt`; seed leadIn in `addKeyframeAt` + `editPose` insert
[X] `camera.ts`: lead-in formula in `zoomPoseAt`; seed leadIn in `addZoomKeyframeAt` + `editZoomPose` insert (reuses `seedLeadIn`)
[X] `propertyControls.tsx`: new 7-preset list + labels; `MotionPreview` + `MotionPicker`; `LeadInField`; swap `TransitionFields` select (exclude `instant`)
[X] `PropertiesPanel.tsx`: swap 3 Motion selects for `MotionPicker`; add "Animate over" `LeadInField` to active object + zoom keyframe sections
[X] `ContextToolbar.tsx`: swap zoom ramp select for `MotionPicker`
[X] `Timeline.tsx`: lead-in ramp before object + zoom keyframe diamonds
[X] `npx tsc -b` green
[ ] User browser verification pass

## Work Log

[2026-07-20] Implemented spec 21 end-to-end. `npx tsc -b` clean.

- **Types** (`src/types.ts`): `EasingKind` now the 7 presets (`instant` added, three quads removed); `leadIn?: number` added to `Keyframe` and `CameraKeyframe`.
- **Easing** (`src/lib/easing.ts`): `ease('instant', u)` = `u >= 1 ? 1 : 0`; quad cases removed.
- **Object engine** (`src/lib/keyframes.ts`): `defaultTransitionEasing` fades repointed quad→cubic; new `DEFAULT_LEAD_IN = 0.8` and exported `seedLeadIn(existing, time)` (clamps to gap-to-previous); `poseAt` per-segment body now uses the shared lead-in formula (`animStart`/`t < animStart` hold/`span>1e-9?…:1` guards); `addKeyframeAt` push branch + `editPose` insert branch seed `leadIn` (in-place updates untouched).
- **Camera engine** (`src/lib/camera.ts`): `zoomPoseAt` mirrors the lead-in formula; `addZoomKeyframeAt` + `editZoomPose` insert seed `leadIn` via `seedLeadIn`.
- **Controls** (`src/components/propertyControls.tsx`): rewrote `EASINGS`/`EASING_LABELS` to the 7 presets; added `MotionPreview` (self-contained rAF SVG curve+dot, UI-only), `MotionPicker` (native select + preview, optional `exclude`/`color`), and `LeadInField` ("Animate over" slider + hold-then-move bar). `TransitionFields` Motion uses `MotionPicker` with `exclude={['instant']}`.
- **Panel** (`src/components/PropertiesPanel.tsx`): three Motion dropdowns → `MotionPicker`; "Animate over" `LeadInField` added to the active object-keyframe and zoom-keyframe sections (with `kfGap`/`zkfGap`, `setKeyframeLeadIn`/`setZoomKeyframeLeadIn`).
- **Toolbar** (`src/components/ContextToolbar.tsx`): zoom ramp Motion select → `MotionPicker`; dropped now-unused `EasingKind` import.
- **Timeline** (`src/components/Timeline.tsx`): lead-in ramp gradient drawn over the moving window `[time − leadIn, time]` before each object and zoom keyframe diamond.

[2026-07-20] QoL: clicking a keyframe diamond on the timeline now seeks the playhead to it.

- `src/components/Timeline.tsx`: `move-keyframe` / `zoom-move-keyframe` now use the same click-vs-drag threshold as markers — a <3px press dispatches no retime transient and, on mouse-up, seeks (`onSeek`) to the keyframe's absolute time (object: `startTime + time`; zoom: `startTime + transitionIn + time`). Drag past the threshold still retimes as before.

[2026-07-20] QoL batch (6 items, some beyond spec 21 but same session). `npx tsc -b` clean.

1. **Apply-motion-to-all button** — object + zoom active-keyframe panels get "Apply this motion to all keyframes" (shown when >1 kf), setting every keyframe's `easing` to the active one's. `src/components/PropertiesPanel.tsx` (`applyEasingToAllKeyframes` / `applyZoomEasingToAllKeyframes`).
2. **New keyframes inherit last-used easing** — `seedEasing(existing, time)` (new export in `src/lib/keyframes.ts`, nearest earlier kf's easing, else nearest later, else `DEFAULT_EASING`) now feeds all four creation sites (object `addKeyframeAt`/`editPose` insert; camera `addZoomKeyframeAt`/`editZoomPose` insert) instead of hardcoded `DEFAULT_EASING`.
3. **Video audio waveform** — `VideoData.waveform?` added (`src/types.ts`); `ImportModal.tsx` decodes it via `generateWaveform` (try/catch; silent/unsupported videos fall through); Timeline bar renders the waveform for `video` as well as `audio`.
4. **Thicker bars / smaller render** — `LANE_HEIGHT` 32→40 (label line-height → `leading-10`) in `Timeline.tsx`; default timeline split 0.22→0.26 of window height in `App.tsx`.
5. **Sane wheel-zoom on laptops** — both the timeline zoom (`Timeline.tsx`, `ZOOM_WHEEL_SENSITIVITY`) and render-area zoom (`Canvas.tsx`, `WHEEL_ZOOM_SENSITIVITY`) now scale the factor by actual scroll distance (`exp(-deltaY_px * s)`, deltaMode-normalized, clamped [0.8, 1.25]) instead of a fixed ±10% per event — trackpads no longer fly.
6. **Visible enter/exit ramps** — the On Appear / On Exit gradient on timeline bars went from `rgba(255,255,255,0.35)→transparent` to `0.85→0.15` (`Timeline.tsx`).

[2026-07-20] Waveform on re-add too: `handleAddExistingAsset` (`App.tsx`) is now async and regenerates the audio/video waveform from the cached blob (`getAssetBlob` + `generateWaveform`, try/catch), so re-adding an existing asset shows the same waveform as a fresh import. Handler stays fire-and-forget from `onAddAsset`.
