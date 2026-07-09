# 14 — Video Sequencing (trim / slice / hide)

**Status**: In Progress

## Overview

Make cutting between video clips a real editing workflow. Three features, each shippable on its own:

1. **Trim (R1–R8)** — separate *trim* (which part of the source plays) from *speed* (how fast). Add `sourceIn`/`sourceOut` to `AudioData`/`VideoData`. Today every media path derives `rate = originalDuration/duration`, so dragging a clip edge shorter **speeds it up** instead of trimming. New universal mapping: `sourceTime = sourceIn + clipProgress*span`, `rate = span/duration` (span = `sourceOut - sourceIn`).
2. **Slice (R10)** — `SPLIT_OBJECT` reducer action + `S` shortcut to split a selected audio/video clip at the playhead into two independent objects. Depends on the trim model.
3. **Hide (R11)** — a `hidden?: boolean` flag on `TimelineObject` and `CameraZoom` that keeps the item in the project/timeline but skips it in every render/audio/export/camera path. Eye toggle + `H` shortcut.

Full spec: `SPECS/14-video-sequencing.md`. Architecture guide: `CLAUDE.md`.

## Task Context

### The universal mapping (single source of truth)
Add centralized helpers so all ~7 inline sites agree. Recommended location: a small module (e.g. `src/lib/mediaTiming.ts`) or extend an existing lib.
```ts
function sourceSpan(d)              { return (d.sourceOut ?? d.originalDuration) - (d.sourceIn ?? 0) }
function clipRate(d, duration)     { return clamp(sourceSpan(d) / duration, 0.25, 4) }
function sourceTimeAt(d, progress) { return (d.sourceIn ?? 0) + progress * sourceSpan(d) }
```
Defaults `sourceIn=0, sourceOut=originalDuration` reproduce today's behavior bit-for-bit (backward compatible).

### Key files & current line refs (from spec; verify before editing)
- **Model**: `src/types.ts` — `AudioData` (100–105), `VideoData` (107–111), `TimelineObject` (5–31), `CameraZoom` (124–134), `ProjectAction` (174–191). Add `SPLIT_OBJECT` action.
- **Reducer/undo**: `src/hooks/useProject.ts` — mirror `DUPLICATE_OBJECT` (deep-clone `data`+`keyframes`) for `SPLIT_OBJECT`. One dispatch = one undo entry. Actions `UPDATE_OBJECT`/`UPDATE_ZOOM` already do shallow merge for `hidden`.
- **Preview audio/video**: `src/hooks/useAudioPlayback.ts` — rate at `:71-72, :97-98, :137-138`; `sourceTime` at `:147-148, :167-168, :189-190`. Also the hide skip sites (registration + tick loop).
- **Preview canvas**: `src/hooks/useCanvasRenderer.ts` — blits the shared video element; inherits the seek fix. Verify no separate source-0 assumption.
- **Compositor**: `src/lib/renderer.ts:43` — visibility filter, extend with `&& !obj.hidden`.
- **Camera resolver**: `src/lib/camera.ts` — `resolveCamera` + `governingZoomAt` filter `!z.hidden` before the sort.
- **Export**: `src/lib/ffmpegExport.ts` — decoder path (`:330-341`), element-seek fallback (`:739-747`), 3 audio mixdowns (`:167-172, 417-424, 684-691`) incl. `source.start(when, offset, duration)` audio-trim; hide enumerations (`:144, 225, 614, 748`). `src/lib/exportWorker.ts:72, 157-163`.
- **Decoder**: `src/lib/videoDecoder.ts:179-208` — **no change** (accepts arbitrary source time, handles non-zero CTS); only the source time passed in changes.
- **Timeline UX**: `src/components/Timeline.tsx` — split edge handles (top=speed at `:160-178`/`:179-192`, bottom=trim); drag-state shapes (`:43-44`) need `originalSourceIn`/`originalSourceOut`; hover-gated handle visibility; eye toggle per row + camera track.
- **PropertiesPanel**: `src/components/PropertiesPanel.tsx:57` — speed readout → editable speed field; add numeric In/Out fields.
- **Total duration**: `src/hooks/usePlayback.ts:12` — **includes** hidden objects (R11.2, no change).
- **App**: `src/components/App.tsx` — keyboard block (~`:225`) for `S` (slice) and `H` (hide); set selection to left half after split; create defaults `sourceIn:0, sourceOut:duration` (`:160-161`). `src/components/ImportModal.tsx:213, 232` import defaults.

### Resolved Open Questions (from spec)
- **OQ3 speed**: keep `duration` as stored field; derive `rate = span/duration`. A speed input writes `duration = span/speed`. No redundant source of truth.
- **OQ7 slice key**: bare `S`. **Hide key**: `H`.
- **OQ8 keyframe continuity**: insert interpolated pose (`poseAt`) at the cut boundary of each half iff keyframes bracket the split.
- **OQ9 naming**: left keeps `name`; right = `${name} (2)`.
- **R10.4/OQ10**: camera zooms are NOT sliced in v1.
- **R11.2**: total duration counts hidden objects (timeline geometry must not jump).

### Suggested ordering (spec Implementation Notes)
1. Types + centralized helpers → route all inline sites through them (mechanical correctness fix; nothing user-visible).
2. Export audio-trim (`source.start(when, offset, duration)`) — 3 near-identical blocks; factor.
3. Hide (R11) — cheapest, most isolated, high-value; can ship ahead of trim.
4. Trim UX (R8) — split top/bottom edge handles + PropertiesPanel speed/In/Out.
5. Slice (R10) — atomic reducer action + `S` binding; keyframe bucketing is the tricky bit.
6. Camera zoom hide (R11.3) if not folded into step 3.

### Conventions (CLAUDE.md)
- Verify with `npx tsc -b` — keep green. **Do NOT run dev server / browser automation.** Hand the user a "click X, look for Y" checklist after changes.
- `UPDATE_OBJECT` shallow-merges → nested `data` must be passed **whole**.

## Blockers/Issues

None currently. Spec 09 is NOT a blocker (OQ1 resolved — trim is additive on current infra).

## TODO

### Step 1 — Types + centralized helpers ✅
[X] Add `sourceIn?`/`sourceOut?` to `AudioData` and `VideoData` (`src/types.ts`)
[X] Add `hidden?: boolean` to `TimelineObject` and `CameraZoom`
[X] Add `SPLIT_OBJECT` action to `ProjectAction`
[X] Create centralized `sourceSpan`/`clipRate`/`sourceTimeAt` helpers → `src/lib/mediaTiming.ts` (also `srcIn`/`srcOut`/`RATE_MIN`/`RATE_MAX`)
[X] Route `useAudioPlayback.ts` through helpers (rate + sourceTime, all 3 sites)
[X] Route export paths through helpers (`ffmpegExport.ts`, `exportWorker.ts`)
[X] Set `sourceIn:0, sourceOut:duration` defaults on import (`ImportModal.tsx`); App placeholder create + existing projects rely on `??` fallbacks

### Step 2 — Export audio-trim ✅
[X] Change 3 audio mixdown blocks to `source.start(when, offset, duration)` with `offset=sourceIn`, length=`span` (prerenderAudioMix, WebCodecs, MediaRecorder)

### Step 3 — Hide (R11) ✅
[X] Renderer visibility filter `&& !obj.hidden` (`renderer.ts`)
[X] `useAudioPlayback` skip hidden (don't register → cleanup pauses+unregisters; skip tick + seek loops)
[X] Export enumerations exclude hidden (audio mixdowns + video draw + asset setup loops; totalDuration UNCHANGED)
[X] `resolveCamera`/`governingZoomAt` filter hidden zooms before the sort
[X] Eye toggle on timeline object bars + camera track (dimmed + dashed for hidden); `EyeIcon` SVG helper
[X] `H` shortcut toggles hidden on selected object OR zoom
[X] Confirm total duration still includes hidden (usePlayback — no change) & `.brep` round-trips (whole-object serialize)

**Decision (R11.1 vs R11.2/R11.8):** spec R11.1 lists the export `totalDuration` scans as skip sites, but R11.2 (geometry must not jump) and R11.8 (all-hidden → black MP4 of correct length) require totalDuration to COUNT hidden. Resolved in favor of the Acceptance Criteria: export totalDuration includes hidden; only mixdown/draw/asset-setup enumerations skip hidden.

### Step 4 — Trim UX (R8) ✅
[X] Split edge handles top (speed) / bottom (trim), both edges, audio/video only
[X] Hover-gated handle visibility (amber trim halves + `[`/`]` bracket glyph, `ew-resize` cursor)
[X] Right-edge trim: adjust `sourceOut`+`duration` rate-constant (bounded by asset length)
[X] Left-edge trim: adjust `sourceIn`+`startTime`+`duration` rate-constant (right edge fixed, bounded sourceIn≥0 & startTime≥0)
[X] Narrow-clip fallback → single speed handle when `width < 28px` (`SPLIT_HANDLE_MIN_WIDTH`)
[X] Speed-clamp updated to `[span/4, span*4]` (identical to before for untrimmed clips)
[X] PropertiesPanel: editable Speed field + numeric In/Out fields (orthogonal; In/Out keep rate constant)

### Step 5 — Slice (R10) ✅
[X] `SPLIT_OBJECT` reducer: R10.1 math, deep-clone data+keyframes; left REUSES id, right gets fresh id
[X] Keyframe bucketing (R10.3) incl. boundary continuity pose (robust rule: pin cut pose whenever keyframed, covers all-before/all-after too)
[X] `S` shortcut in App.tsx (guard: audio/video selected + playhead strictly inside; reducer double-guards)
[X] Left half stays selected after split (via id-reuse — no re-selection needed)
[X] Naming: right = `${name} (2)`

### Step 6 — Camera zoom hide ✅ (folded into Step 3)
[X] `resolveCamera`/`governingZoomAt` filter hidden zooms; Timeline camera-track bars dimmed + dashed; eye toggle

### Verification
[X] `npx tsc -b` green
[X] `eslint` — 0 new errors (9 pre-existing, all in untouched code)
[ ] Hand user validation checklist per feature (trim / slice / hide) — **awaiting browser testing by user**

## Work Log

[2026-07-09] Created task document from SPECS/14-video-sequencing.md. Grounded in current `src/types.ts` and `src/hooks/useAudioPlayback.ts`. No code changes yet.

[2026-07-09] Steps 1 & 2 complete (trim model foundation + export audio-trim). Backward-compatible — untrimmed clips behave bit-identically via `??` fallbacks. `tsc -b` green.
- New: `src/lib/mediaTiming.ts` — `srcIn`/`srcOut`/`sourceSpan`/`clipRate`/`sourceTimeAt` + `RATE_MIN`/`RATE_MAX`. Single source of truth for the output-time→source-time + rate mapping.
- `src/types.ts`: `sourceIn?`/`sourceOut?` on `AudioData`/`VideoData`; `hidden?` on `TimelineObject`/`CameraZoom`; `SPLIT_OBJECT` action.
- `src/hooks/useAudioPlayback.ts`: all rate + sourceTime sites (create/update/tick/seek) routed through helpers.
- `src/lib/ffmpegExport.ts`: 2 video sourceTime sites + all 3 audio mixdowns now use `clipRate` and `source.start(startTime, srcIn, sourceSpan)` (audio trim).
- `src/lib/exportWorker.ts`: video sourceTime via `sourceTimeAt`.
- `src/components/ImportModal.tsx`: imported audio/video get explicit `sourceIn:0, sourceOut:duration`.
- Files modified: types.ts, mediaTiming.ts (new), useAudioPlayback.ts, ffmpegExport.ts, exportWorker.ts, ImportModal.tsx

[2026-07-09] Step 3 complete (Hide / R11). `tsc -b` green.
- `renderer.ts`: visibility filter extended with `!obj.hidden` (covers preview + export in one place).
- `camera.ts`: `resolveCamera` + `governingZoomAt` filter `!z.hidden` before the governing-window sort (no chain-from/to effect).
- `useAudioPlayback.ts`: hidden clips not registered → cleanup pauses+unregisters live element; tick + seek loops skip hidden.
- `ffmpegExport.ts` + `exportWorker.ts`: audio-mixdown + video-draw + asset-setup loops skip hidden; totalDuration scans left intact.
- `Timeline.tsx`: `EyeIcon` SVG; hover-revealed eye toggle on object bars + zoom bars (always shown when hidden); hidden bars dimmed + dashed outline.
- `App.tsx`: `H` toggles hidden on selected object OR zoom.
- Files modified: renderer.ts, camera.ts, useAudioPlayback.ts, ffmpegExport.ts, exportWorker.ts, Timeline.tsx, App.tsx

[2026-07-09] Steps 4, 5, 6 complete (Trim UX, Slice, Camera-zoom hide). `tsc -b` green; eslint 0 new errors. Spec 14 implementation complete pending browser verification.
- **Trim UX (Step 4):** `PropertiesPanel.tsx` — read-only Speed readout replaced with editable Speed field + In/Out numeric fields (Speed writes duration; In/Out keep rate constant & recompute duration). `Timeline.tsx` — audio/video edge handles split into speed (top, existing) + trim (bottom, new, amber + `[`/`]`); `trim-left`/`trim-right` DragState + rate-constant handlers (transient→commit = 1 undo entry); left-trim keeps right timeline edge fixed; narrow clips (<28px) fall back to single speed handle; speed-clamp switched to span-based.
- **Slice (Step 5):** `useProject.ts` — `splitObject` helper + `SPLIT_OBJECT` case; left half reuses original id (selection persists), right gets fresh id + `(2)` name; both preserve rate; keyframe bucketing with cut-pose continuity. `App.tsx` — `S` shortcut (guarded).
- **Camera zoom hide (Step 6):** folded into Step 3 (`resolveCamera` filter + Timeline dimming + eye toggle).
- Files modified: PropertiesPanel.tsx, Timeline.tsx, useProject.ts, App.tsx

[2026-07-09] **User feedback on trim:** "when you trim a video file, it should keep the original length of bar, so you can then restore it." Added trim **ghosts** to `Timeline.tsx`: the played region is the solid bar (= duration/footprint); the trimmed-off source is drawn as a dimmed, hatched, **draggable** stub on each end so the bar keeps its original full length and trimmed media stays visible + recoverable. `bright + ghost` always sums to the original clip length; drag a ghost (or the bottom trim handle) back out to restore. Ghost length = `srcIn/rate` (left) and `(originalDuration-srcOut)/rate` (right). Dragging a ghost reuses the `trim-left`/`trim-right` drag. `tsc -b` green; no new lint.
- Files modified: Timeline.tsx

**Design decisions worth noting:**
- Slice left half REUSES the original object id (deviates from spec R10.1's "id: new" for left) → selection stays on it for free (R10.6) and the shared video element isn't recreated. Right half gets a fresh id.
- Keyframe continuity pins the cut pose whenever the object is keyframed & no keyframe sits on the cut — broader than the spec's "bracketed only" rule, so all-before / all-after keyframe layouts also stay continuous instead of popping to the base pose.
- PropertiesPanel In/Out edits keep startTime fixed & recompute duration (rate-constant); the timeline left-trim handle instead keeps the right edge fixed (industry-standard). Two different affordances, both rate-constant.
