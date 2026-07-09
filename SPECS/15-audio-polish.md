# 15-audio-polish

## Overview

Finish the audio feature set. The plumbing — audio/video object types, per-object volume, playback sync (`useAudioPlayback`), waveform peak data, and export muxing — already exists. The remaining ~30% is polish that makes audio pleasant to work with:

1. **Timeline waveforms everywhere** — draw a waveform on **video** clips too (today it's audio-only), and address the perf cost of the current 200-`<div>`-per-clip approach.
2. **Volume fade envelopes** — fade in / fade out (and ideally a full volume curve), which the codebase has **no** concept of today. This rides on the **spec 12 easing engine** (a fade is an eased volume ramp).
3. **Verify multi-track export mixdown** — the ask was "confirm export sums all audio+video tracks, not just one." **Investigation confirms it already does** (all three export tiers sum every audio-bearing object into one `OfflineAudioContext`). So this ask collapses from "build" to "verify + lock in with a regression test."

### What exists today (grounded)

- **Waveform generation:** `generateWaveform(blob, numPeaks=200)` (`assetStore.ts:171-194`) decodes channel 0 (mono), computes a **max-abs peak per bucket**, returns `number[]` (0–1). Called **only for audio imports** (`ImportModal.tsx:201-206`), stored on `AudioData.waveform` (`ImportModal.tsx:214`), persisted in project state. **`VideoData` has no `waveform` field** — video clips get no waveform path at all.
- **Timeline waveform render:** ~200 `<div>` bars (`flex-1`, `height: peak*100%`, `opacity-30`) inside each **audio** clip bar (`Timeline.tsx:416-427`). This is the "200 waveform divs per audio clip" flagged as a re-render cost in spec 09. Not a canvas.
- **Preview volume:** a single scalar `el.volume = data.volume` on a raw `HTMLMediaElement` (`useAudioPlayback.ts:54,75`). **No WebAudio graph in preview**, no `GainNode`, no time-varying gain. Mute is a separate global boolean.
- **Export mixdown (CONFIRMED multi-track):** all three tiers filter `objects` to `type === 'audio' || 'video'` and loop over **all** of them into a shared `OfflineAudioContext.destination`, each via its own `GainNode` (`gain.gain.value = data.volume`, constant) + `playbackRate` + `source.start(obj.startTime)`:
  - Worker pre-render `prerenderAudioMix` (`ffmpegExport.ts:140-193`, 48 kHz) → transferred to the worker as `RenderedAudio` (`exportWorkerTypes.ts:3-17`), which only AAC-encodes it (`exportWorker.ts:204-260`).
  - WebCodecs main-thread fallback (`ffmpegExport.ts:390-429`, 48 kHz).
  - MediaRecorder fallback (`ffmpegExport.ts:661-707`, 44.1 kHz).
  Nothing selects "just one" — the multi-track ask is already satisfied.
- **No fade/envelope anywhere:** repo-wide search for `fade`/`envelope` → **zero hits**. `gain` appears only as the three constant export `GainNode`s. Volume is one scalar per clip everywhere.

## Requirements

### Waveforms
- **R1**: Video clips show a waveform on the timeline, like audio clips. This requires generating waveform peaks for **video** imports (decode the video's audio track) and storing them where the renderer can read them (see Technical Considerations for where — `VideoData.waveform` vs. an asset-keyed cache).
- **R2**: Waveform rendering scales without tanking timeline perf. The current 200-`div`-per-clip DOM approach multiplied across many clips (and re-rendered on every `globalTime` tick per spec 09) is the concern — move waveform drawing to a `<canvas>` per clip (or memoize the div row so it doesn't re-render on playhead ticks). Coordinate with spec 09-A3 (don't re-render the timeline at 60 Hz).
- **R3**: Waveforms reflect trim (spec 14): when a clip is trimmed to `[sourceIn, sourceOut]`, the drawn waveform shows that sub-range, not the whole source. (Soft dependency — if 14 lands first.)

### Fades / volume envelope
- **R4**: Per-clip **fade in** and **fade out** (durations in seconds) on audio and video objects. A fade is an eased volume ramp from 0→`volume` (in) and `volume`→0 (out) over the fade duration, relative to clip start/end.
- **R5**: Fades apply consistently in **preview and export** (the recurring preview/export-parity theme — cf. spec 11). Preview must ramp the element volume over time; export must apply the ramp in the mixdown gain.
- **R6 (stretch)**: A full **volume keyframe envelope** (arbitrary volume keyframes over the clip), reusing the spec 12 `Keyframe`/easing types — with simple fade-in/out as the common-case sugar over it.

### Export mixdown verification
- **R7**: Add an automated/repeatable check that a project with **multiple** overlapping audio + video sources exports with **all** of them audible and correctly gained (not just the first/last). This locks in the already-correct behavior against regression (e.g. a future refactor accidentally breaking the loop).

## Technical Considerations

### Where fades live — the key architectural point

Volume is **not** rendered by `renderFrame`; it's applied in two other places (preview `useAudioPlayback`, export `OfflineAudioContext` mixdown). So — unlike spec 12's visual keyframes — the spec-12 **engine's `renderFrame` integration does not cover audio gain**. What *is* reusable is the **pure easing math** (`ease`/`lerp`/`evaluateTrack` from `src/lib/easing.ts`): a fade is just `gain(t) = volume * ease(kind, clamp(t/fadeIn))` etc. So "build the primitive once" still holds — the curve functions are shared; only the **application site** differs (canvas alpha for visuals, audio gain for sound).

- **Export application:** in each mixdown block (`ffmpegExport.ts:169-172, 420-424, 687-691`), replace the constant `gain.gain.value = volume` with WebAudio automation: `gain.gain.setValueAtTime(0, start)`, `linearRampToValueAtTime(volume, start + fadeIn)`, … `setValueAtTime(volume, end - fadeOut)`, `linearRampToValueAtTime(0, end)` — or `setValueCurveAtTime` for non-linear eases. This runs on the main thread before the buffer is transferred to the worker (unchanged handoff).
- **Preview application:** preview uses **raw media elements with no gain node** (`useAudioPlayback.ts`). Two options: (a) set `el.volume = envelope(t) * baseVolume` on each sync tick (cheap, coarse — good enough for fades), or (b) route preview audio through a WebAudio `MediaElementAudioSourceNode → GainNode` graph and automate the gain (accurate, larger change; note this graph would also be the place preview *volume* control moves to). *(See Open Questions.)*

### Waveform for video (R1)

`generateWaveform` (`assetStore.ts:171-194`) already `decodeAudioData`s any blob — it works on a video file's audio track unchanged. Needed:
- Call it for `type === 'video'` imports in `ImportModal.tsx` (guard: videos may have no audio track → `decodeAudioData` throws → catch and skip, as the audio path already does).
- Storage: either add `waveform?: number[]` to `VideoData` (symmetry with `AudioData`, simplest), or store waveforms in an asset-keyed cache so two clips of one asset share peaks. *(Open Question.)*
- Render: extend the Timeline waveform block (`Timeline.tsx:416-427`), currently gated on `obj.type === 'audio'`, to video too — ideally via the R2 canvas approach.

### Relevant types (verbatim, `src/types.ts`)

```ts
export type AudioData = {
  assetId: string; volume: number; originalDuration: number
  waveform?: number[]       // ~200 peak values for visualization
}
export type VideoData = {
  assetId: string; volume: number; originalDuration: number
}
```

Proposed additions (additive, optional):
```ts
// both AudioData and VideoData:
  fadeIn?: number           // seconds, default 0
  fadeOut?: number          // seconds, default 0
  volumeKeyframes?: Keyframe[]   // R6 stretch; spec-12 Keyframe[], overrides fadeIn/out if present
// VideoData also:
  waveform?: number[]       // R1
```

`RenderedAudio` handoff type (unchanged, `exportWorkerTypes.ts:3-17`) — fades are baked into the mixed buffer before transfer, so the worker needs no change:
```ts
export type RenderedAudio = {
  channelData: Float32Array[]; sampleRate: number
  numberOfChannels: number; length: number
}
```

### Files touched
- `src/types.ts` — `fadeIn`/`fadeOut` (+ optional `volumeKeyframes`, `VideoData.waveform`).
- `src/lib/assetStore.ts` — reuse `generateWaveform` for video (no change to the fn itself).
- `src/components/ImportModal.tsx` — generate waveform for video imports; set fade defaults.
- `src/components/Timeline.tsx` — waveform on video clips + canvas/memoized rendering (perf).
- `src/components/PropertiesPanel.tsx` — fade-in/out controls in the existing Audio section (`:91-111`); the panel currently only has a volume slider.
- `src/hooks/useAudioPlayback.ts` — apply the envelope in preview (per-tick `el.volume` or a gain-node graph).
- `src/lib/ffmpegExport.ts` — gain **automation** in all three mixdown blocks (`:169-172, 420-424, 687-691`).
- `src/lib/easing.ts` (from spec 12) — import `ease`/`evaluateTrack` for envelope shape.

## Related Systems and Tasks

- **Depends on `SPECS/12-keyframe-easing-engine.md`** for the easing math (`src/lib/easing.ts`), especially R6's volume keyframes. Simple linear fades can ship without 12, but reusing its curves keeps one source of truth.
- **Interacts with `SPECS/14-video-sequencing.md`** — trim (`sourceIn`/`sourceOut`) changes both what the **waveform** shows (R3) and how export audio is scheduled (`source.start(when, offset, duration)`); fades are relative to the *trimmed* clip's start/end. Sequence 14's audio-trim and 15's fade-automation into the same mixdown edit to avoid double-touching those three blocks.
- **Interacts with `SPECS/11-audio-pitch-on-rate-change.md`** and **`SPECS/09-in-video-perf.md` B4** — all three modify the export audio pre-render (`OfflineAudioContext` on the main thread → `RenderedAudio` transfer). Coordinate so the mixdown block is refactored once, not three times.
- `src/lib/assetStore.ts` (`generateWaveform`), `src/components/Timeline.tsx` (waveform render), `src/hooks/useAudioPlayback.ts` (preview volume), `src/lib/ffmpegExport.ts` + `src/lib/exportWorker.ts` + `src/lib/exportWorkerTypes.ts` (export mixdown).

## Open Questions

1. **Preview fade implementation.** Per-tick `el.volume = envelope(t)*volume` (cheap, coarse, no graph) vs. a `MediaElementAudioSourceNode → GainNode` WebAudio graph (accurate automation, bigger change, moves preview volume into WebAudio). *(Recommended: per-tick `el.volume` for v1 fades — simple and imperceptibly coarse for fades; revisit a gain graph only if R6 full envelopes need sample-accurate curves.)*
2. **Waveform storage for video.** `VideoData.waveform` (simple, per-object, duplicated for same-asset clips) vs. an asset-keyed waveform cache (shared, one more indirection). *(Recommended: `VideoData.waveform` for symmetry with audio now; an asset-keyed cache is a later optimization if projects reuse assets heavily.)*
3. **Waveform render tech.** Canvas per clip vs. memoized div row. Spec 09 flags the div approach as a 60 Hz re-render cost. *(Recommended: `<canvas>` per clip, drawn once on mount/resize/trim — also fixes the perf note in 09.)*
4. **Fades vs. full envelope scope.** Ship simple `fadeIn`/`fadeOut` seconds first (R4), or go straight to volume keyframes (R6)? *(Recommended: fade-in/out durations for v1; expose the full keyframe envelope later using spec 12's `Keyframe[]`.)*
5. **Fade curve shape.** Linear ramp, or equal-power/exponential (better for audio crossfades)? *(Recommended: linear for v1; `setValueCurveAtTime` with an equal-power curve is a small upgrade later.)*
6. **Is the mixdown-verification (R7) a unit test or a manual A/B?** *(Recommended: a lightweight automated check — render a short project with two known tones at different start times and assert both frequencies are present in the output buffer — plus keep a manual listen in the acceptance pass.)*

## Acceptance Criteria

- A video clip on the timeline shows a waveform of its audio track; scrolling/zooming the timeline stays smooth (no per-frame waveform re-render).
- Setting fade-in/out on an audio (and a video) clip produces an audible eased ramp that is **the same in preview and in the exported MP4**.
- A trimmed clip's waveform and fades are relative to the trimmed range, not the whole source (given spec 14).
- Exporting a project with ≥2 overlapping audio/video sources yields all of them audible at their correct volumes (R7 check passes) — locking in today's confirmed-correct mixdown.
- Projects with no fades and audio-only waveforms behave identically to today.

## Implementation Notes

- Start with **R7** (a cheap mixdown regression test) — it's low-effort, protects behavior you already have, and documents the confirmed multi-track summing.
- Then **video waveforms** (R1/R2/R3) — mostly a one-line reuse of `generateWaveform` for video imports + a Timeline render change; independent of the keyframe engine, so it can land before spec 12.
- Then **fades** (R4/R5) — do the export gain-automation and preview envelope together, and fold them into the same mixdown refactor that specs 09-B4/11/14 touch (coordinate to edit those three blocks once).
- Keep `RenderedAudio` and the worker unchanged (fades bake into the buffer pre-transfer).
- Validate: a 440 Hz tone with a 1s fade-in exports with a matching ramp; a two-tone overlapping project exports both tones; preview and export ramps match by ear and by buffer inspection.

---
*Draft — ready for review. R7 (verify mixdown) and video waveforms can proceed independently; fades (R4–R6) want `SPECS/12` and coordination with the 09/11/14 mixdown edits — resolve Open Questions 1 & 4 before `/task 15`.*
