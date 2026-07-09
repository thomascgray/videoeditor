# 14-video-sequencing

## Overview

Make cutting between video clips a real editing workflow. You can *already* place multiple video objects at different times/lanes — that is cutting between clips — but the model has one genuine correctness gap and the UX has a couple of rough edges:

1. **The model bug (primary):** there is **no trim**. A clip's `duration` is the only length control, and every media path derives `rate = originalDuration / duration` — so **dragging a clip's edge shorter speeds the video up** (and longer slows it down) instead of trimming it. You cannot take "seconds 10–20 of a 60s clip." This ticket adds `sourceIn`/`sourceOut` to separate **trim** (which part of the source plays) from **speed** (how fast it plays).
2. **Seamless cuts (perf):** seeking multiple `HTMLVideoElement`s at cut points stalls preview — this is the domain of **spec 09** and is largely covered there; this spec depends on and defers to it.
3. **Editing ergonomics (UX):** a proper trim interaction (edge-drag = trim, not speed), an explicit speed control, and optionally a magnetic sequence lane with ripple.
4. **Slice (R10):** splitting a video/audio clip at the playhead into two independent objects — the direct payoff of R1's trim model.
5. **Hide (R11):** a per-object (and per-zoom) `hidden` flag that keeps the item in the project/timeline but skips it in every renderer, audio, export, and camera path — non-destructive muting/toggling for A/B work.

### What exists today (grounded)

There is **no** `sourceIn`/`sourceOut`/`inPoint`/`outPoint`/`trim` concept in `src/` (the only `trim` hits — `Canvas.tsx:852,856` — are freehand point pruning). Every media path maps output time → source time with the same **speed-stretch** formula, always assuming the source starts at 0:

```
clipProgress = (globalTime - obj.startTime) / obj.duration
sourceTime   = clipProgress * originalDuration          // assumes source starts at 0
playbackRate = originalDuration / obj.duration           // clamped 0.25–4
```

Confirmed at every site:
- **Preview audio/video position + rate:** `useAudioPlayback.ts:52-53, 78-79, 118-131, 127-137` (`sourceTime = clipProgress * originalDuration`; `playbackRate = originalDuration/duration` clamped 0.25–4). The shared video element (registered in `mediaRegistry.ts`, keyed by object id) is seeked by this hook; the canvas just blits its current frame (`useCanvasRenderer.ts:38-43`).
- **Timeline edge-drag:** `resize-right` changes **duration only** (`Timeline.tsx:179-192`); `resize-left` changes `startTime` + `duration` (`Timeline.tsx:160-178`). For audio/video the new duration is clamped to `[originalDuration/4, originalDuration*4]` — a **speed** clamp, not a trim clamp. **This behavior is preserved by R8** (the top half of the new split handle IS today's edge-drag); trim is a separate bottom-half handle.
- **Export (all three tiers):** decoder path `exportWorker.ts:157-163` and `ffmpegExport.ts:330-341`; element-seek fallback `ffmpegExport.ts:739-747`; audio mixdown `ffmpegExport.ts:167-172, 417-424, 684-691` — all use `sourceTime = clipProgress * originalDuration` / `rate = originalDuration/duration`.
- **Speed readout:** PropertiesPanel already displays `(originalDuration / obj.duration).toFixed(2)}x` (`PropertiesPanel.tsx:57`) — proof the current model *is* speed-only.
- **Decoder is trim-ready:** `videoDecoder.getFrameAtTime(sourceTimeSeconds)` (`videoDecoder.ts:179-208`) already handles a non-zero starting CTS and anchors to the first available frame; it takes an arbitrary source time, so passing a `sourceIn`-offset source time needs no decoder change — only the callers.

## Requirements

### Model — separate trim from speed
- **R1**: `VideoData` and `AudioData` gain `sourceIn` and `sourceOut` (seconds into the source asset). Defaults `sourceIn = 0`, `sourceOut = originalDuration` — which makes existing projects **behave exactly as today** (backward-compatible).
- **R2**: The played source span is `[sourceIn, sourceOut]`; its length is `span = sourceOut - sourceIn`. Redefine the universal mapping as:
  ```
  sourceTime   = sourceIn + clipProgress * span
  playbackRate = span / obj.duration            // clamped 0.25–4
  ```
  When `span == duration`, `rate == 1` (pure trim, no speed change).
- **R3**: **Trim and speed are separate operations at the UX layer, exposed on different handles** (see R8). Speed changes adjust `duration` alone (span unchanged → `rate` changes). Trim changes adjust the source span AND `duration` together (rate-constant) — for a rate-1 clip this reveals a different sub-range of the source without changing playback speed. The **existing edge-drag** (top half of the edge handle) continues to change speed — no behavior change for existing muscle memory. Trim is a **new, distinct affordance** (bottom half of the edge handle).
- **R4**: Trim is bounded by the source: `0 ≤ sourceIn < sourceOut ≤ originalDuration`. You cannot trim past the ends of the asset.

### Preview + export must honor trim
- **R5**: Preview video/audio seek to `sourceIn + clipProgress*span` (not `clipProgress*originalDuration`), and set `playbackRate = span/duration`. The shared-element seek-sync in `useAudioPlayback` uses the new mapping.
- **R6**: Export (decoder path, element-seek fallback, and all three audio mixdown blocks) uses the new mapping. **Audio trim in export** requires `AudioBufferSourceNode.start(when, offset, duration)` with `offset = sourceIn` and a played length of `span` — today it calls `source.start(obj.startTime)` and plays the whole buffer (`ffmpegExport.ts:172, 424, 691`); it must pass the offset + duration so trimmed audio doesn't play the whole file.
- **R7**: Frame accuracy at cut points is inherited from spec 09 (WebCodecs decode path); this spec must not reintroduce the seek-race. Overlapping/adjacent clips of the **same asset** each get their own decoder (spec 09 B3, keyed by object id) — trim makes same-asset reuse (e.g. two different sub-ranges of one clip) common, so per-object decoders matter more here.

### UX
- **R8** — **Split top/bottom edge handles on audio/video clips** (both edges, symmetric):
  - Each edge (left AND right) of an audio or video timeline bar becomes a **vertically split handle**: the **top half** does the current edge-drag (speed = adjust `duration` only, source span unchanged) and the **bottom half** does **trim** (rate-constant: adjust the source span AND `duration` together so `rate` stays where it was).
  - Handles are **revealed on hover** — no visual change on non-hovered clips. Bottom-half trim handle carries a distinct cursor/icon (e.g. bracket `[` / `]` or a scissor icon) so top vs bottom is legible.
  - **Right edge, top (speed):** unchanged from today — resize increases/decreases `duration`, `rate = span/duration` shifts, source span (`sourceIn`/`sourceOut`) unchanged. Clamped `[originalDuration/4, originalDuration*4]` (or `[span/4, span*4]` once trim exists) — the existing speed clamp.
  - **Right edge, bottom (trim):** adjusts `sourceOut` and `duration` **together** so `rate` stays constant. New `sourceOut = sourceIn + span'` where `span'` is chosen from the drag delta; `duration' = span' / rate`. Bounded `sourceOut ≤ originalDuration`.
  - **Left edge, top (speed):** unchanged from today — resize adjusts `startTime` and `duration`, `rate` shifts, source span unchanged.
  - **Left edge, bottom (trim):** adjusts `sourceIn`, `startTime`, and `duration` **together** so `rate` stays constant. New `sourceIn = sourceOut - span'`; `startTime` shifts by the change so the clip's *right edge in timeline space stays fixed* (industry-standard left-trim behavior); `duration' = span' / rate`. Bounded `sourceIn ≥ 0`.
  - **Non-media object types** (photo/text/shape/annotation/freehand): **unchanged** — single-handle edges that resize `duration` only. Trim doesn't apply.
  - **Narrow-clip fallback**: when the bar is too narrow to safely hit two vertical halves (e.g. < ~24px tall or the clip is very short horizontally), fall back to top-half-only (speed); users edit trim from PropertiesPanel numeric fields.
  - **PropertiesPanel** gets: an editable **speed** field (replacing the readout at `PropertiesPanel.tsx:57`) and numeric **In**/**Out** fields (source seconds) for precise trim.
- **R9 (optional/stretch)**: A magnetic **sequence lane** where clips snap end-to-end with ripple (deleting/trimming a clip closes the gap). Out of v1 core; specified as a follow-on.

### Slice (split at playhead) — audio/video only
- **R10**: A **`SPLIT_OBJECT`** action on the reducer that splits a selected audio/video object at the current `globalTime` into two independent `TimelineObject`s. Triggered by a **keyboard shortcut** (proposed: `S`) while an audio/video object is selected AND the playhead is strictly inside the clip's lifespan (`startTime < globalTime < startTime + duration`); otherwise no-op. Non-media object types are **out of scope for v1** (their "slice" would just be duplicate-with-time-split — deferrable).
- **R10.1** — **The math (uses R2's mapping directly).** Let `splitOffset = globalTime - obj.startTime` (clip-relative seconds), and `span = sourceOut - sourceIn`. The split point in source coords is `sourceSplit = sourceIn + (splitOffset / duration) * span`. The two halves:
  - **Left:** `{...obj, id: new, duration: splitOffset, data: {...data, sourceIn, sourceOut: sourceSplit}}`
  - **Right:** `{...obj, id: new, startTime: obj.startTime + splitOffset, duration: obj.duration - splitOffset, data: {...data, sourceIn: sourceSplit, sourceOut}}`
  - Both preserve `rate = span/duration` (each half's own `span/duration` equals the original's, so the split is speed-transparent — a cut at rate 1 stays rate 1, a 2× clip stays 2× on both halves). This is only clean because R1–R2 exist; **slice depends on trim**.
- **R10.2** — **The original object is removed** (replaced by the two halves). Undo restores the original as one entry (single reducer dispatch containing remove + two adds, or an atomic `SPLIT_OBJECT` action — the latter, cleaner).
- **R10.3** — **Keyframes at the split.** Keyframes are clip-relative (spec 12 R3). For `obj.keyframes` bucketed by `kf.time` vs `splitOffset`:
  - `kf.time < splitOffset` → stays on left half (time unchanged).
  - `kf.time > splitOffset` → moves to right half with `kf.time -= splitOffset`.
  - `kf.time === splitOffset` → duplicated onto both (left keeps as `time = splitOffset`, right becomes `time = 0`).
  - **Continuity across the cut**: capture the interpolated pose at `splitOffset` (via `poseAt`) and insert it as a keyframe at the boundary of each half **iff** there wasn't already one there and there are keyframes bracketing the split — otherwise the tween would restart from the base pose on the right half. If no keyframes bracket the split, no insertion is needed. See Open Question 8.
- **R10.4** — **Camera zooms are not sliced in v1** (they're not `TimelineObject`s and their governing-window model doesn't map cleanly onto split-at-instant). Deferred; note in Open Questions.
- **R10.5** — **Naming**: left keeps `obj.name`; right becomes `${obj.name} (2)` (or use `createTimelineObject`'s counter — see Open Question 9). Both keep the same `assetId` — this is exactly the "same-asset, different sub-range" case R7 already covers via per-object decoders.
- **R10.6** — **Selection after split**: the **left half** becomes the selected object (feels like an in-place edit; the user's cursor is on the newly-cut trailing edge of the left half).

### Hide (non-destructive skip)
- **R11**: A **`hidden?: boolean`** flag on `TimelineObject` (default `false`/undefined). When true, the object is **kept in the project and timeline** but **skipped in every render/audio/export path**. This is a soft mute for A/B / trial-and-error work — cheaper than delete/undo cycles.
- **R11.1** — **Skip sites** (must all check `!obj.hidden`):
  - **Renderer visibility filter** (`src/lib/renderer.ts:43`) — the single-line filter that already gates by time; extend with `&& !obj.hidden`.
  - **Audio playback**: `useAudioPlayback.ts` per-object registration + tick loop (`:142, 185`). Hidden audio/video: don't create/register the media element (or unregister/pause it) and skip the seek-sync tick.
  - **Export enumerations**: `ffmpegExport.ts:144, 225, 614, 748` (`totalDuration` scan + audio mixdown scans + element-seek scan) and `exportWorker.ts:72, 157`. Hidden objects are excluded from mixdown and video-frame draw.
  - **Preview canvas**: inherits the fix from the renderer filter (no separate site).
- **R11.2** — **Total duration includes hidden objects.** `usePlayback.ts:12` still counts them so the timeline geometry / playhead limit **does not jump** when the user toggles hidden — otherwise scrubbing behavior changes underfoot. (Justification: the object is still *placed* in time; hide just gates rendering.)
- **R11.3** — **Camera zoom parity**: `CameraZoom` gains its own `hidden?: boolean`. `resolveCamera` (`src/lib/camera.ts`) filters out hidden zooms **before** the governing-window sort so an "invisible" zoom has no chained-from effect on its neighbors. Same skip in the two export paths that pass `resolveCamera(project.zooms, t)` (they inherit it for free) and in the Timeline camera track (dimmed rendering).
- **R11.4** — **UX affordances (both)**:
  - **Eye toggle on the timeline row/bar**: an `👁 / 👁‍🗨` (eye / eye-slash) icon on each timeline row. Hidden rows/bars render at reduced opacity + dashed border to make the state obvious. Click toggles.
  - **Keyboard shortcut** on selected object OR selected zoom (proposed: `H`) — toggles `hidden`. Mutual-exclusive selection (App.tsx) means only one type is affected per press.
- **R11.5** — **Reducer actions**: extend `UPDATE_OBJECT` / `UPDATE_ZOOM` (a shallow `{hidden: true}` merge already works — no new action needed). One dispatch per toggle = one undo entry.
- **R11.6** — **Interaction with slice**: splitting a hidden object produces two hidden objects (property is copied). Splitting is still allowed on hidden clips (the model change is orthogonal to visibility).
- **R11.7** — **Interaction with animateIn / enter / exit / keyframes**: none — those layers never run because the object is skipped at the visibility filter stage.
- **R11.8** — **Export UI**: no separate control; hide is authored in the editor, respected on export. If *all* objects are hidden, export proceeds and produces a black-only MP4 of `totalDuration` length (correct behavior, not an error).

## Technical Considerations

### Type changes (verbatim current → proposed, `src/types.ts`)

Current:
```ts
export type AudioData = {
  assetId: string; volume: number; originalDuration: number
  waveform?: number[]
}
export type VideoData = {
  assetId: string; volume: number; originalDuration: number
}
```

Proposed (additive, both optional with today-equivalent defaults):
```ts
export type AudioData = {
  assetId: string; volume: number; originalDuration: number
  waveform?: number[]
  sourceIn?: number    // seconds into source; default 0
  sourceOut?: number   // seconds into source; default originalDuration
}
export type VideoData = {
  assetId: string; volume: number; originalDuration: number
  sourceIn?: number    // default 0
  sourceOut?: number   // default originalDuration
}

// R11 — hidden flag on both the base object and camera zooms
export type TimelineObject = {
  // ...existing fields...
  hidden?: boolean     // default false; when true, skipped in all render/audio/export paths
}

export type CameraZoom = {
  // ...existing fields...
  hidden?: boolean     // default false; when true, filtered out of resolveCamera
}
```

**R10 slice** needs no new type — the split is a reducer action that produces two `TimelineObject`s from one, using the R1 trim fields already added above. It does, however, add one new `ProjectAction`:

```ts
// src/hooks/useProject.ts
type ProjectAction =
  | ...existing actions...
  | { type: 'SPLIT_OBJECT'; id: string; globalTime: number }   // atomic: remove original, add left + right halves; one undo entry
```

A single shared helper should centralize the mapping so all ~7 sites agree (they currently each inline it):
```ts
// pseudo — one source of truth
function sourceSpan(d: AudioData | VideoData) { return (d.sourceOut ?? d.originalDuration) - (d.sourceIn ?? 0) }
function clipRate(d, duration)  { return clamp(sourceSpan(d) / duration, 0.25, 4) }
function sourceTimeAt(d, clipProgress) { return (d.sourceIn ?? 0) + clipProgress * sourceSpan(d) }
```

### Every site that must switch to the new mapping (R1–R7 — trim)
- `src/hooks/useAudioPlayback.ts` — `:52-53, 78-79, 118-119, 127-137, 148-149, 170-171` (rate + `sourceTime`).
- `src/hooks/useCanvasRenderer.ts` — video frame source is the shared element, so it inherits the fix from `useAudioPlayback`; verify no separate assumption of source-0.
- `src/components/Timeline.tsx` — **audio/video clips only**: split each edge handle into top-half (speed, existing behavior at `:179-192` and `:160-178`) + bottom-half (trim). Bottom-half drag adjusts the source span + duration + startTime (left edge) rate-constant. Hover state gates handle visibility. Drag-state shapes (`:43-44`) need `originalSourceIn`/`originalSourceOut` for the trim path. Non-media clip types keep the current single-handle behavior unchanged.
- `src/components/PropertiesPanel.tsx` — `:57` speed readout → editable speed; add numeric **In**/**Out** fields (source seconds).
- `src/lib/ffmpegExport.ts` — decoder path (`:330-341`), element-seek fallback (`:739-747`), and **all three** audio mixdowns (`:167-172, 417-424, 684-691`) incl. the `source.start(when, offset, duration)` audio-trim change.
- `src/lib/exportWorker.ts` — `:157-163` sourceTime mapping.
- `src/components/App.tsx:160-161` + `src/components/ImportModal.tsx:213, 232` — set `sourceIn: 0, sourceOut: duration` defaults on create/import (or rely on the `?? ` fallbacks).
- `src/lib/videoDecoder.ts` — **no change** (already accepts arbitrary source time + handles non-zero CTS, `:179-208`); only the source time passed in changes.

### Slice sites (R10)
- `src/hooks/useProject.ts` — add `SPLIT_OBJECT` action. Deep-clones `data` and `keyframes` per side (mirror the `DUPLICATE_OBJECT` pattern), assigns fresh IDs, applies the R10.1 math + R10.3 keyframe bucketing. **One dispatch = one undo entry**.
- `src/components/App.tsx` — keyboard handler (near the existing shortcut block `~:225`): when `S` is pressed with a selected object of type `'audio'|'video'` and `startTime < globalTime < startTime+duration`, dispatch `SPLIT_OBJECT`. Then set selection to the new left half's id.
- Reducer must handle the case where a selected object is split (selection is updated in App.tsx post-dispatch — the reducer itself doesn't own selection state).
- No renderer/export changes for slice: after the reducer runs, the two halves are just normal objects and flow through the R1–R7 trim path.

### Hide sites (R11)
- **Renderer**: `src/lib/renderer.ts:43` — extend the visibility filter with `&& !obj.hidden`.
- **Audio playback**: `src/hooks/useAudioPlayback.ts` — skip hidden objects in the registration effect AND the per-frame seek-sync loop (`:142, 185`). If an object becomes hidden while its element is registered, `pause()` and unregister it from `mediaRegistry` so `useCanvasRenderer` stops blitting stale frames.
- **Export**: `src/lib/ffmpegExport.ts` — filter hidden objects out of every enumeration (`:144, 225, 614, 748`, decoder path `:330`, element-seek `:739`, audio mixdowns `:167, 417, 684`). `src/lib/exportWorker.ts:72, 157`.
- **Total duration**: `src/hooks/usePlayback.ts:12` — **includes** hidden objects (R11.2). No change.
- **Camera resolver**: `src/lib/camera.ts` — `resolveCamera` filters `zooms.filter(z => !z.hidden)` **before** the sort. `governingZoomAt` uses the same filtered list.
- **Timeline UI**: `src/components/Timeline.tsx` — per-row eye/eye-slash toggle button in the lane gutter (`~:380` area for object rows) AND on the pinned Camera track for zooms. Hidden bars render with reduced opacity (e.g. `opacity-40`) + dashed border via a conditional Tailwind class near `:410, :530`.
- **Keyboard shortcut**: `src/components/App.tsx` — `H` toggles `hidden` on `selectedObjectId` OR `selectedZoomId` (mutually exclusive per existing invariant).
- **PropertiesPanel**: minor — hidden state may show a small indicator (out of scope for v1 authoring; the timeline eye is the source of truth).

### Interaction with other specs
- **Spec 09 (in-video perf):** owns frame-accurate export decode + play-based preview + per-object decoders. This spec's trim makes per-object-id decoder keying (09-B3) essential, and the export audio-trim (`start(offset,duration)`) layers onto 09's `RenderedAudio` pre-render. **Sequencing decisions:** land 09's decode/perf work first (or concurrently), then trim on top — trimming the buggy seek-storm path would just move the bug.
- **Spec 11 (audio pitch on rate change):** the pitch fix is defined against `rate = originalDuration/duration`; with trim, `rate = span/duration`. The fix still applies — centralize so both use `clipRate()`. A trimmed-but-not-sped clip (`rate == 1`) sidesteps the pitch issue entirely, which is the common case after this change.

## Related Systems and Tasks

- `SPECS/09-in-video-perf.md` — export frame accuracy, preview play-based rendering, per-object decoders (`VideoData` note there explicitly says "no trim offset exists — decode-from-start is always correct" — **this spec is what changes that assumption**, so 09 and 14 must be sequenced deliberately).
- `SPECS/11-audio-pitch-on-rate-change.md` — rate→pitch semantics; shares the `rate` definition.
- `SPECS/07-import-assets.md` — where `playbackRate = originalDuration/duration` and the 0.25–4 clamp originated.
- `src/hooks/useAudioPlayback.ts`, `src/lib/mediaRegistry.ts`, `src/hooks/useCanvasRenderer.ts` (preview); `src/lib/ffmpegExport.ts`, `src/lib/exportWorker.ts`, `src/lib/videoDecoder.ts` (export); `src/components/Timeline.tsx`, `src/components/PropertiesPanel.tsx` (UX).

## Open Questions

1. ~~**Sequencing vs. spec 09.**~~ **Resolved:** proceed now on the current infra. Trim is additive — every media site just changes the `sourceTime` target and the `rate` derivation; `videoDecoder` already accepts arbitrary source times; backward compat is bit-identical with the default `sourceIn=0, sourceOut=originalDuration`. The seek-storm / frame-accuracy issues 09 addresses exist today and are not worsened by trim. When 09 lands, decode internals swap out and trim inherits the frame-accuracy improvements for free. **Slice specifically** is safe on the shared-video-element preview: split halves are sequential, so no two elements fight over the same asset simultaneously.
2. ~~**Trim UX: edge-drag semantics.**~~ **Resolved:** edge-drag is **preserved** as speed (today's behavior — no muscle-memory break). Trim is a **new, distinct affordance** implemented as the bottom half of a vertically split edge handle on audio/video clips (symmetric on both edges, revealed on hover). See R8.
3. **Speed as an explicit field.** Store `speed` explicitly, or keep it derived (`span/duration`) with duration as the stored field? *(Recommended: keep `duration` as the stored timeline field and derive `rate`/speed = `span/duration`; a "speed" input writes `duration = span/speed`. Avoids a redundant source of truth.)*
4. **Left-trim and keyframes (spec 12).** Per-object keyframe times are clip-relative (spec 12 R3). Left-trim changes `startTime`; confirm keyframes stay anchored to clip start (they should, being relative) so trimming doesn't desync animations. *(Recommended: keyframes relative to `startTime`; left-trim shifts `startTime` and the animation moves with it.)*
5. **Magnetic sequence lane / ripple (R9).** In scope now or a separate ticket? *(Recommended: separate follow-on ticket; ship the trim model + basic trim handles first.)*
6. **Transitions (crossfade/dissolve) at clip boundaries.** Natural once sequencing exists, but distinct work. *(Recommended: out of scope here; note as future — it will want the keyframe/opacity engine from spec 12.)*
7. **Slice keyboard shortcut letter.** `S` is proposed but conflicts nothing today; verify no existing binding. Alternative: `Ctrl+K` (Premiere-style "add edit"). *(Recommended: bare `S` for a shorter mnemonic; only Ctrl-prefixed if it turns out to conflict.)*
8. **Keyframe continuity across a split.** R10.3 says: if a slice happens between two keyframes, insert an interpolated pose at the boundary of each half so the tween doesn't restart from the base pose on the right. This is the correct behavior for animated media (rare on audio, occasional on video). *(Recommended: implement the boundary insertion; document that a slice through a running tween produces a keyframe pair at the cut. Skip only if it complicates the reducer materially.)*
9. **Naming split halves.** Left keeps `name`; right becomes `${name} (2)`, or use `createTimelineObject`'s type-counter (which would rename to `Video N`)? *(Recommended: `${name} (2)` — preserves the user's rename intent. If they never renamed it, both halves still start with `Video N` which is fine.)*
10. **Slice for camera zooms.** R10.4 defers this. Zoom slicing is odd because the governing-window model chains A→B: a split would need to produce two zooms whose A-end pose matches the split-instant resolved pose. Deferrable. *(Recommended: out of scope for v1; revisit if users ask.)*
11. **Hidden objects in `.brep` project export.** The project persistence (`projectStorage.ts`) already serializes the whole `TimelineObject` — `hidden` rides along for free. Confirm no filtering on export/import. *(Recommended: persist as-is; hide is authoring state and should round-trip.)*
12. **Hidden and undo history.** Toggling hidden is one dispatch = one undo entry. If a user hides → deletes something else → un-hides, the un-hide is a separate step from the delete. Fine. *(No action needed — noting for the implementer.)*

## Acceptance Criteria

### Trim (R1–R7)
- Dragging a clip's edge **trims** it (shows a different sub-range of the source) without changing playback speed; the video/audio content at a given timeline instant matches `sourceIn + clipProgress*span` in both preview and export.
- Setting an explicit speed (e.g. 2×) changes playback rate without re-trimming, and preview and export agree.
- A trimmed clip (e.g. seconds 10–20 of a 60s source) plays the correct 10s window in preview and exports the correct window, frame-accurate (per spec 09), with audio starting at `sourceIn` (not the file start).
- Existing projects (no `sourceIn`/`sourceOut`) behave bit-identically to today (defaults reproduce the current speed-stretch when a clip was previously dragged).
- Two clips referencing the same asset with different trim ranges export correctly (per-object decoders).

### Slice (R10)
- Selecting an audio or video clip, positioning the playhead inside its lifespan, and pressing the slice shortcut produces two clips whose combined timeline coverage is identical to the original.
- Playback across the cut is content-continuous: at `globalTime = originalStartTime + splitOffset - ε` you see the last frame of the left half; at `+ ε` you see the first frame of the right half; source content matches.
- Both halves preserve the original's rate (2× stays 2×, 1× stays 1×).
- Undo restores the original clip as a single history entry; redo re-splits.
- Slice is a no-op when: no object is selected, selected object is not audio/video, or the playhead is outside the clip.
- Slicing an animated object keeps the animation continuous (poses at the cut match on both sides per R10.3).
- Two split halves of the same asset export correctly (this is exactly the same-asset-different-range case R7 covers).

### Hide (R11)
- Toggling the eye icon on a timeline row (or pressing the hide shortcut on a selected object/zoom) sets `hidden` and takes effect immediately: the object stops rendering in the canvas, its audio stops, and the timeline row visually indicates the hidden state.
- Hidden objects do not appear in exported MP4 video frames and are not summed into exported audio.
- Hidden camera zooms do not affect the camera at any time (they don't chain-from or chain-to neighboring zooms).
- Total project duration and timeline geometry **do not change** when an object is hidden/unhidden — only the render/audio/export output changes.
- Toggling hidden is one undo entry.
- `.brep` export/import round-trips the `hidden` flag.
- A project with all objects hidden exports a black-only MP4 of the correct length (not an error).

## Implementation Notes

### Suggested ordering
1. **Types + centralized helpers.** Add `sourceIn`/`sourceOut` to `AudioData`/`VideoData` and `hidden` to `TimelineObject`/`CameraZoom`. Land `sourceSpan`/`clipRate`/`sourceTimeAt` in one module and route all ~7 inline sites through them — this alone is a mechanical, high-value correctness fix and makes the pitch spec (11) consistent for free. Nothing user-visible changes yet.
2. **Export audio-trim** (`source.start(when, offset, duration)`) — three near-identical blocks in `ffmpegExport.ts`; factor. Land alongside step 1 so trim math is respected end-to-end from day one.
3. **Hide (R11).** Cheapest, most isolated, high-value. One filter per skip site. Ship the eye toggle + `H` shortcut. Independent of trim/slice; can even ship as its own PR ahead of trim.
4. **Trim UX (R8) — split top/bottom edge handles on audio/video + PropertiesPanel speed/In/Out fields.** Top half preserves today's edge-drag (speed); bottom half is new (trim). Symmetric on both edges. Hover-gated visibility. Non-media clips unchanged.
5. **Slice (R10).** Adds one atomic reducer action + one keyboard binding. Depends on step 1's trim model to be meaningful. Keyframe bucketing (R10.3) is the trickiest bit — write it against the shared `poseAt` helper.
6. **Camera zoom hide** (R11.3) if not folded into step 3 — small filter in `resolveCamera` + Timeline camera-track dimming.

### Watchpoints
- Do the export audio-trim carefully — three near-identical blocks; factor them.
- Spec 09 is **not** a blocker (OQ 1 resolved) — trim is additive on the current infra. When 09 lands later, decode internals swap out; trim inherits the fixes.
- `SPLIT_OBJECT` must **deep-clone** `data` + `keyframes` per half (mirror `DUPLICATE_OBJECT` in `useProject.ts`) so the two halves are independent.
- Selection invariant after `SPLIT_OBJECT`: dispatch the split, then set `selectedObjectId` to the left half's new id in `App.tsx` (the reducer doesn't own selection).
- Hide + audio: when an audio/video object becomes hidden while its media element is registered in `mediaRegistry`, `useAudioPlayback` must `pause()` + unregister — otherwise `useCanvasRenderer` will keep drawing the stale last-decoded frame.
- **R8 hit-testing**: splitting the edge handle top/bottom requires per-half hitboxes in `Timeline.tsx`'s pointer handler. Hover state must gate visibility (add a hovered-clip-id state on the timeline row) and swap the cursor per half.
- **R8 narrow-clip fallback**: audio/video clips shorter horizontally than the split-handle target size fall back to top-only (speed). Trim is available from PropertiesPanel numeric In/Out fields.

### Validation checklist (per feature)
- **Trim**: trim a clip, scrub, play, export; confirm the same 10s window frame-for-frame in preview vs. exported MP4.
- **Slice**: split a 20s clip at t=10s, play both halves back-to-back, confirm content continuity at the cut. Split a clip with an animation running across the cut; confirm no pop.
- **Hide**: hide an object mid-preview, confirm it disappears from canvas and audio drops out; unhide, confirm it comes back exactly where it was. Hide a zoom, confirm the camera stops honoring it and doesn't chain-from it either.

---
*Draft — the two blocking OQs (1 sequencing, 2 edge-drag semantics) are resolved. Remaining OQs (3–12) are lower-stakes and can be resolved during `/task 14`. Ready for implementation review.*
