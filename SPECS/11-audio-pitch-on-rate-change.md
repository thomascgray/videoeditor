# 11-audio-pitch-on-rate-change

## Overview

When a clip is rate-stretched (its bar dragged shorter/longer — there is no trim, so `duration ≠ originalDuration` means "play the whole source faster/slower"), **preview and export handle audio pitch differently**:

- **In-app preview**: audio speeds up but **pitch is preserved** (time-stretch — sounds natural, just faster).
- **Export**: audio speeds up **and pitch rises** (the "chipmunk" effect — faster = higher).

The two should agree. This ticket documents why they differ and decides which behavior is correct, then makes them consistent.

## Root Cause Analysis (investigated 2026-07-07)

The playback-rate factor is the same in both paths: `rate = originalDuration / duration`, clamped to `[0.25, 4]`. What differs is the audio engine and its pitch semantics.

### Preview — pitch preserved (HTMLMediaElement)
`useAudioPlayback` drives audio through `HTMLMediaElement.playbackRate` (`useAudioPlayback.ts:53, 79, 131`). The DOM media element's `preservesPitch` property **defaults to `true`**, so the browser applies real-time time-stretching: playback speeds up, pitch stays put. `preservesPitch` is never set in the codebase, so we get the pitch-preserving default for free.

### Export — pitch shifts (Web Audio AudioBufferSourceNode)
Export pre-renders the audio mix through an `OfflineAudioContext` and sets `AudioBufferSourceNode.playbackRate.value` (`ffmpegExport.ts:251` in the WebCodecs path, `ffmpegExport.ts:517` in the MediaRecorder path). A buffer source's `playbackRate` is a **pure resampler** — it changes sample cadence, so pitch scales directly with speed. The Web Audio API has **no `preservesPitch` equivalent** for `AudioBufferSourceNode`; playbackRate always shifts pitch.

So: same rate, two engines, opposite pitch behavior. Preview = time-stretch; export = resample.

Note: this affects **both directions** — speeding up raises pitch in export, slowing down lowers it. Preview keeps pitch in both.

## Requirements

- **R1. Consistency**: preview and export produce the **same** audio pitch behavior for rate-stretched clips (both speed-up and slow-down).
- **R2. Correct default**: the agreed default is **pitch-preserving** (matches preview and modern-editor expectations) — *pending confirmation in Open Questions*. If instead we decide pitch-shift is desired, preview must change to match export.
- **R3. No regression**: unstretched clips (`duration == originalDuration`, rate = 1) sound identical to today in both paths. Photo/annotation-only exports unaffected.

## Technical Considerations

### Types (existing, `src/types.ts`)
- `VideoData` / `AudioData` — `{ assetId, volume, originalDuration }`. `rate = originalDuration / obj.duration`. No trim offset exists (rate-stretch is the only speed mechanism).
- Rate clamp `[0.25, 4]` is shared by preview and both export paths.

### Options to make export pitch-preserving (R2 = preserve)
Web Audio can't time-stretch natively, so export needs one of:
- **A. JS time-stretch library** (e.g. `soundtouchjs` / a phase-vocoder). Run the decoded buffer through it at the target rate with pitch preserved, then feed the result into the encoder. Adds a dependency; quality/CPU tradeoffs. Most robust.
- **B. Render each clip through an `HTMLMediaElement` with `preservesPitch = true`** and capture. Problem: `MediaElementAudioSourceNode` is **not** usable inside `OfflineAudioContext`, and real-time capture (MediaStream) defeats the offline/fast-export model. Not recommended.
- **C. WebCodecs `AudioDecoder` + manual DSP.** Decode PCM ourselves and time-stretch. Effectively reimplements A; only worth it if we drop the OfflineAudioContext mix entirely.

### Cheap alternative (R2 = shift, i.e. make preview match export)
- Set `el.preservesPitch = false` on the media elements in `useAudioPlayback`. One line. Makes preview chipmunk to match export. Almost certainly **not** the desired UX, but it's the trivial way to get consistency if we decide pitch-shift is acceptable.

### Interaction with spec 09 / B4
Export audio is pre-rendered on the **main thread** (OfflineAudioContext isn't available in workers) and this stays true after B4. So any time-stretch step (Option A) also runs on the main thread before the buffer is transferred to the worker as `RenderedAudio`. Factor the stretch into that pre-render step.

## Related Systems and Tasks

- `src/hooks/useAudioPlayback.ts` (preview audio, `preservesPitch` default).
- `src/lib/ffmpegExport.ts:251` (WebCodecs export audio), `:517` (MediaRecorder export audio).
- `SPECS/09-in-video-perf.md` — export audio pre-render + `RenderedAudio` transfer (B4).
- `SPECS/07-import-assets.md` — where `playbackRate = originalDuration/duration` and the 0.25–4 clamp were introduced.

## Open Questions

1. **Which behavior is correct?** Pitch-preserving (match preview; expected default for a video editor) or pitch-shifting (match export)? *(Recommended: preserve pitch — fix export to match preview.)*
2. **If preserve**: acceptable to add a time-stretch dependency (`soundtouchjs` ≈ a few KB)? Or is quality/CPU a concern for the ≤50 MB / 47s reference clip? *(Recommended: yes, use a vetted library.)*
3. **Future**: should "speed"/pitch be an explicit per-clip control (with an optional "keep pitch" toggle, like Premiere/FCP) rather than an implicit side effect of dragging the bar? Out of scope here, but this bug is a symptom of speed being implicit.
4. Do we care about the MediaRecorder fallback path (`:517`) matching too, or is fixing the primary WebCodecs path enough? *(Recommended: fix both for consistency, same helper.)*

## Acceptance Criteria

- Export a rate-stretched clip (e.g. drag a 10s clip to 5s → 2× speed) and confirm the exported audio pitch **matches the in-app preview** (per the R2 decision) — verified across a speed-up and a slow-down.
- Rate-1 clips are bit-for-bit unchanged in behavior.
- A counter/tone test: a known tone (e.g. 440 Hz) stays 440 Hz in export when pitch-preservation is the chosen behavior.

## Implementation Notes

- Centralize the rate→audio logic so preview and export share one decision. The stretch (if Option A) belongs in the export audio pre-render (`ffmpegExport.ts` OfflineAudioContext block, and the same block feeding B4's `RenderedAudio`).
- Confirm the chosen library works in the export context (main thread) and handles the 0.25–4 rate range.
