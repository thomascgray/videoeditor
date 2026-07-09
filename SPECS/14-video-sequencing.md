# 14-video-sequencing

## Overview

Make cutting between video clips a real editing workflow. You can *already* place multiple video objects at different times/lanes — that is cutting between clips — but the model has one genuine correctness gap and the UX has a couple of rough edges:

1. **The model bug (primary):** there is **no trim**. A clip's `duration` is the only length control, and every media path derives `rate = originalDuration / duration` — so **dragging a clip's edge shorter speeds the video up** (and longer slows it down) instead of trimming it. You cannot take "seconds 10–20 of a 60s clip." This ticket adds `sourceIn`/`sourceOut` to separate **trim** (which part of the source plays) from **speed** (how fast it plays).
2. **Seamless cuts (perf):** seeking multiple `HTMLVideoElement`s at cut points stalls preview — this is the domain of **spec 09** and is largely covered there; this spec depends on and defers to it.
3. **Editing ergonomics (UX):** a proper trim interaction (edge-drag = trim, not speed), an explicit speed control, and optionally a magnetic sequence lane with ripple.

### What exists today (grounded)

There is **no** `sourceIn`/`sourceOut`/`inPoint`/`outPoint`/`trim` concept in `src/` (the only `trim` hits — `Canvas.tsx:852,856` — are freehand point pruning). Every media path maps output time → source time with the same **speed-stretch** formula, always assuming the source starts at 0:

```
clipProgress = (globalTime - obj.startTime) / obj.duration
sourceTime   = clipProgress * originalDuration          // assumes source starts at 0
playbackRate = originalDuration / obj.duration           // clamped 0.25–4
```

Confirmed at every site:
- **Preview audio/video position + rate:** `useAudioPlayback.ts:52-53, 78-79, 118-131, 127-137` (`sourceTime = clipProgress * originalDuration`; `playbackRate = originalDuration/duration` clamped 0.25–4). The shared video element (registered in `mediaRegistry.ts`, keyed by object id) is seeked by this hook; the canvas just blits its current frame (`useCanvasRenderer.ts:38-43`).
- **Timeline edge-drag:** `resize-right` changes **duration only** (`Timeline.tsx:179-192`); `resize-left` changes `startTime` + `duration` (`Timeline.tsx:160-178`). For audio/video the new duration is clamped to `[originalDuration/4, originalDuration*4]` — a **speed** clamp, not a trim clamp.
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
  When `span == duration`, `rate == 1` (pure trim, no speed change) — the new default for edge-drag.
- **R3**: **Trim ≠ speed at the UX layer.** Dragging a clip edge **trims** by default: it adjusts `sourceOut` (right edge) or `sourceIn` + `startTime` (left edge) **together with** `duration` so that `rate` stays constant (rate 1 for an untouched clip). A **separate, explicit speed control** changes `duration` (and thus `rate`) **without** changing the source span.
- **R4**: Trim is bounded by the source: `0 ≤ sourceIn < sourceOut ≤ originalDuration`. You cannot trim past the ends of the asset.

### Preview + export must honor trim
- **R5**: Preview video/audio seek to `sourceIn + clipProgress*span` (not `clipProgress*originalDuration`), and set `playbackRate = span/duration`. The shared-element seek-sync in `useAudioPlayback` uses the new mapping.
- **R6**: Export (decoder path, element-seek fallback, and all three audio mixdown blocks) uses the new mapping. **Audio trim in export** requires `AudioBufferSourceNode.start(when, offset, duration)` with `offset = sourceIn` and a played length of `span` — today it calls `source.start(obj.startTime)` and plays the whole buffer (`ffmpegExport.ts:172, 424, 691`); it must pass the offset + duration so trimmed audio doesn't play the whole file.
- **R7**: Frame accuracy at cut points is inherited from spec 09 (WebCodecs decode path); this spec must not reintroduce the seek-race. Overlapping/adjacent clips of the **same asset** each get their own decoder (spec 09 B3, keyed by object id) — trim makes same-asset reuse (e.g. two different sub-ranges of one clip) common, so per-object decoders matter more here.

### UX
- **R8**: Trim handles on the timeline clip: dragging an edge shows/updates the trimmed range; a distinct affordance (modifier key, or a dedicated speed field in PropertiesPanel) performs a speed change. The PropertiesPanel speed readout (`:57`) becomes an editable speed control.
- **R9 (optional/stretch)**: A magnetic **sequence lane** where clips snap end-to-end with ripple (deleting/trimming a clip closes the gap). Out of v1 core; specified as a follow-on.

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
```

A single shared helper should centralize the mapping so all ~7 sites agree (they currently each inline it):
```ts
// pseudo — one source of truth
function sourceSpan(d: AudioData | VideoData) { return (d.sourceOut ?? d.originalDuration) - (d.sourceIn ?? 0) }
function clipRate(d, duration)  { return clamp(sourceSpan(d) / duration, 0.25, 4) }
function sourceTimeAt(d, clipProgress) { return (d.sourceIn ?? 0) + clipProgress * sourceSpan(d) }
```

### Every site that must switch to the new mapping
- `src/hooks/useAudioPlayback.ts` — `:52-53, 78-79, 118-119, 127-137, 148-149, 170-171` (rate + `sourceTime`).
- `src/hooks/useCanvasRenderer.ts` — video frame source is the shared element, so it inherits the fix from `useAudioPlayback`; verify no separate assumption of source-0.
- `src/components/Timeline.tsx` — `resize-right` (`:179-192`) and `resize-left` (`:160-178`) become **trim** (adjust source range + duration together, rate-constant); add the speed-change affordance. Drag-state shapes (`:43-44`) need `originalSourceIn`/`originalSourceOut`.
- `src/components/PropertiesPanel.tsx` — `:57` speed readout → editable speed; optionally numeric in/out fields.
- `src/lib/ffmpegExport.ts` — decoder path (`:330-341`), element-seek fallback (`:739-747`), and **all three** audio mixdowns (`:167-172, 417-424, 684-691`) incl. the `source.start(when, offset, duration)` audio-trim change.
- `src/lib/exportWorker.ts` — `:157-163` sourceTime mapping.
- `src/components/App.tsx:160-161` + `src/components/ImportModal.tsx:213, 232` — set `sourceIn: 0, sourceOut: duration` defaults on create/import (or rely on the `?? ` fallbacks).
- `src/lib/videoDecoder.ts` — **no change** (already accepts arbitrary source time + handles non-zero CTS, `:179-208`); only the source time passed in changes.

### Interaction with other specs
- **Spec 09 (in-video perf):** owns frame-accurate export decode + play-based preview + per-object decoders. This spec's trim makes per-object-id decoder keying (09-B3) essential, and the export audio-trim (`start(offset,duration)`) layers onto 09's `RenderedAudio` pre-render. **Sequencing decisions:** land 09's decode/perf work first (or concurrently), then trim on top — trimming the buggy seek-storm path would just move the bug.
- **Spec 11 (audio pitch on rate change):** the pitch fix is defined against `rate = originalDuration/duration`; with trim, `rate = span/duration`. The fix still applies — centralize so both use `clipRate()`. A trimmed-but-not-sped clip (`rate == 1`) sidesteps the pitch issue entirely, which is the common case after this change.

## Related Systems and Tasks

- `SPECS/09-in-video-perf.md` — export frame accuracy, preview play-based rendering, per-object decoders (`VideoData` note there explicitly says "no trim offset exists — decode-from-start is always correct" — **this spec is what changes that assumption**, so 09 and 14 must be sequenced deliberately).
- `SPECS/11-audio-pitch-on-rate-change.md` — rate→pitch semantics; shares the `rate` definition.
- `SPECS/07-import-assets.md` — where `playbackRate = originalDuration/duration` and the 0.25–4 clamp originated.
- `src/hooks/useAudioPlayback.ts`, `src/lib/mediaRegistry.ts`, `src/hooks/useCanvasRenderer.ts` (preview); `src/lib/ffmpegExport.ts`, `src/lib/exportWorker.ts`, `src/lib/videoDecoder.ts` (export); `src/components/Timeline.tsx`, `src/components/PropertiesPanel.tsx` (UX).

## Open Questions

1. **Sequencing vs. spec 09.** Trim rides on top of 09's decode/perf rework. Do we (a) finish 09 then do 14, (b) fold trim into 09, or (c) do the *model* (types + mapping + trim UX) now against the current paths and let 09 replace the decode internals later? *(Recommended: (a) — land 09's frame-accurate export + play-based preview first, then add trim; trimming the seek-storm path is wasted effort.)*
2. **Trim UX: edge-drag semantics.** Edge-drag = trim (recommended) with a modifier for speed? Or edge-drag = speed (today) with a separate trim mode? *(Recommended: edge-drag trims by default (industry-standard); Alt/Ctrl-drag or a PropertiesPanel field changes speed. This is a behavior change to the current edge-drag — call it out to the user.)*
3. **Speed as an explicit field.** Store `speed` explicitly, or keep it derived (`span/duration`) with duration as the stored field? *(Recommended: keep `duration` as the stored timeline field and derive `rate`/speed = `span/duration`; a "speed" input writes `duration = span/speed`. Avoids a redundant source of truth.)*
4. **Left-trim and keyframes (spec 12).** Per-object keyframe times are clip-relative (spec 12 R3). Left-trim changes `startTime`; confirm keyframes stay anchored to clip start (they should, being relative) so trimming doesn't desync animations. *(Recommended: keyframes relative to `startTime`; left-trim shifts `startTime` and the animation moves with it.)*
5. **Magnetic sequence lane / ripple (R9).** In scope now or a separate ticket? *(Recommended: separate follow-on ticket; ship the trim model + basic trim handles first.)*
6. **Transitions (crossfade/dissolve) at clip boundaries.** Natural once sequencing exists, but distinct work. *(Recommended: out of scope here; note as future — it will want the keyframe/opacity engine from spec 12.)*

## Acceptance Criteria

- Dragging a clip's edge **trims** it (shows a different sub-range of the source) without changing playback speed; the video/audio content at a given timeline instant matches `sourceIn + clipProgress*span` in both preview and export.
- Setting an explicit speed (e.g. 2×) changes playback rate without re-trimming, and preview and export agree.
- A trimmed clip (e.g. seconds 10–20 of a 60s source) plays the correct 10s window in preview and exports the correct window, frame-accurate (per spec 09), with audio starting at `sourceIn` (not the file start).
- Existing projects (no `sourceIn`/`sourceOut`) behave bit-identically to today (defaults reproduce the current speed-stretch when a clip was previously dragged).
- Two clips referencing the same asset with different trim ranges export correctly (per-object decoders).

## Implementation Notes

- Start with the **model + centralized helpers** (`sourceSpan`/`clipRate`/`sourceTimeAt` in one module) and route all ~7 inline sites through them — this alone is a mechanical, high-value correctness fix and makes the pitch spec (11) consistent for free.
- Add `sourceIn`/`sourceOut` to the types with `??` fallbacks so nothing else breaks before the UX lands.
- Do the export audio-trim (`source.start(when, offset, duration)`) carefully — it changes three near-identical blocks; factor them.
- Then the Timeline trim interaction + PropertiesPanel speed field.
- Coordinate with spec 09's owner on sequencing (Open Question 1) before touching the export decode internals.
- Validate: trim a clip, scrub, play, and export; confirm the same 10s window frame-for-frame in preview vs. exported MP4.

---
*Draft — ready for review. Open Question 1 (sequencing vs. spec 09) and Question 2 (edge-drag = trim, a behavior change) need the user's call before `/task 14`.*
