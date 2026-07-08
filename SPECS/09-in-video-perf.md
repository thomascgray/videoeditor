# 09-in-video-perf

## Overview

Adding a video asset (reference case: 18.7 MB MP4, 1080×1920 portrait, 47s, imported into the default 1920×1080 @ 30fps project) tanks performance in two distinct places:

1. **Editor preview** — confirmed by user: hitting play with the video on the timeline "completely wrecks the playback" (super choppy); scrubbing is similarly janky.
2. **Export** — exporting a project containing a video clip produces "super janky, super framey" output (duplicated/stale frames with visible jumps), and the UI freezes during export.

This spec covers diagnosing and fixing both. The root causes have been identified through code investigation (see below) — this is not a mystery-debugging spec; it's a "we know exactly why, here's what to change" spec.

## Root Cause Analysis (investigated 2026-07-07)

### History: the WebCodecs pipeline was built, then abandoned

Spec 08 designed a VideoDecoder (WebCodecs) + Web Worker export pipeline. Per `TASKS/08-webcodecs-refactor.md`, it was fully built (`src/lib/videoDecoder.ts`, `src/lib/exportWorker.ts`, `src/lib/exportWorkerTypes.ts`) and hit a series of bugs that were fixed one at a time — codec-string rejection (fixed via direct `configure()` + try/catch) and a decode deadlock (fixed by the two-phase demux/decode rewrite). But the **last** bug was never fixed: task-log issue #6, `VideoDecoder error: Failed to parse avcC` — the avcC description bytes extracted from mp4box were malformed, so the decoder rejected the stream *at decode time* on the reference file. That unresolved failure is what actually triggered the 2026-03-29 decision to drop VideoDecoder and fall back to main-thread HTMLVideoElement seeking — it was **not** a pure speed/simplicity trade. The task log records the resulting bottleneck:

> "HTMLVideoElement seeking is now the clear bottleneck (~27s of the export is seek time)."

**✅ RETIRED (2026-07-07 spike) — was the primary risk.** A standalone probe (`src/lib/decoderSpike.ts`, `window.__spike()`) A/B-tested four description strategies against the reference asset (`avc1.640032`, 1080×1920). Result: full-box description FAILS "Failed to parse avcC"; **header-stripped description PASSES** (12 frames, monotonic 30fps timestamps). Codec-string normalization was irrelevant. The fix is confirmed: strip the 8-byte box header (`new Uint8Array(stream.buffer, 8)`) in `getCodecDescription`. The decoder route is viable; B1–B4 are green-lit. (One follow-on found by the spike: decoded frames start at CTS 66,660µs, not 0 — B2's frame-lookup must anchor source-time 0 to the first available frame.) Original risk write-up retained below for context.

**⚠️ Primary risk — the abandonment blocker is NOT one of B2/B3.** The bug that actually killed the pipeline (malformed avcC → decoder rejects the stream at decode time) is unaddressed by any requirement below. B2/B3 fix frame *ownership* and *keying* — bugs that only matter once frames decode successfully. The real blocker lives in `getCodecDescription()` (`videoDecoder.ts:324-336`), which serializes the mp4box config box and returns `stream.buffer.slice(0, getPosition())` — i.e. it **keeps the 8-byte box header** (`[size]['avcC']`) instead of returning only the `AVCDecoderConfigurationRecord`. The canonical mp4box→WebCodecs pattern returns `new Uint8Array(stream.buffer, 8)` (header stripped). This is the likely (probably one-line) cause of "Failed to parse avcC" and MUST be fixed and validated on a real file **before** B1–B3 mean anything. Milestone zero = "the decoder actually decodes the reference file," proven as a spike ahead of the ownership rework. See requirement **B0**.

The decoder/worker files still exist but are **dead code** — nothing calls `new Worker(...)` or `createVideoFrameSource()` outside `exportWorker.ts` (itself unreferenced). Note on B4: the `exportWithWorker()` glue described in the task log was **never committed** — the entire spec-08 arc is a single squashed commit (`42a9cac "08"`), and `git log -S "exportWithWorker"` / `"new Worker"` find only doc mentions, never source. B4 must therefore be **rewritten from the task-log description**, not restored from git. (`vite.config.ts` still has `worker: { format: 'es' }`, so that part is already in place.)

### Export: why the output is "framey"

The live path is `exportWithWebCodecs()` in `src/lib/ffmpegExport.ts:42` (main thread). Per output frame it moves an `HTMLVideoElement` with tiered seeking (`ffmpegExport.ts:133-148`):

- **Small advance (10ms–0.5s)**: sets `videoEl.currentTime` then yields with `setTimeout(0)` — it does **not** wait for the `seeked` event. `drawImage` then samples whatever frame the element currently displays, which is almost always the *previous* frame. Worse, `videoEl.currentTime` reads back the assigned value immediately, so the next iteration's drift check believes the element is in sync while the decoder is still catching up.
- **Large jump (>0.5s)**: waits for `seeked` OR a 50ms timeout — the timeout can fire before the seek completes on a heavy portrait video, capturing the wrong frame.

At 30fps every single output frame takes the small-advance path (33ms > 10ms threshold), so a 47s clip issues ~1410 racing seeks. Each `currentTime` assignment on H.264 forces decode-from-previous-keyframe; the decoder falls behind; the composited output contains runs of duplicated frames punctuated by jumps — exactly "super janky, super framey". This is a **correctness** bug (wrong frames captured), not just a speed problem.

Secondary export issues:
- Export runs entirely on the main thread → UI freezes for the duration.
- Audio pre-render (`decodeAudioData` of the full video + `OfflineAudioContext`) also runs on the main thread.

### Preview: why the editor tanks

Three compounding causes:

1. **Seek-storm rendering** (`src/hooks/useCanvasRenderer.ts:81-119`): the canvas is fed by a *paused* muted `<video>` element that is re-seeked whenever it drifts >0.05s from the timeline. During playback (~60 state updates/sec advancing ~16ms each) that's a seek every ~3 ticks ≈ **15–20 seeks/second**, each one a keyframe-decode-forward operation. The video element is never `play()`ed — the natural, cheap way to advance frames — and each `seeked` event triggers an extra `doRender()` on top of the unconditional one.

2. **Duplicate video element** (`src/hooks/useAudioPlayback.ts:69-71`): a *second* `HTMLVideoElement` is created for the same asset to supply audio, and during playback it actually plays (decoding video+audio, hidden). So one video asset is decoded **twice concurrently** — once playing (audio side) and once via seek-storm (canvas side).

3. **60Hz whole-app React re-render** (`src/hooks/usePlayback.ts:37-44`): `globalTime` is React state updated every rAF, re-rendering `App` → `Canvas` (880 lines), `Timeline` (529 lines, one absolutely-positioned bar per object, 200 waveform divs per audio clip), and `PropertiesPanel` on every frame.

### Latent bugs in the dead decoder pipeline (matter once resurrected)

- `VideoFrameSource.getFrameAtTime()` (`src/lib/videoDecoder.ts:172-200`) **closes and discards the overshoot frame**: when the next decoded frame is past the target it returns `bestFrame` and closes `frame` — a frame the *next* call needs. Result: dropped source frames (stutter) whenever target times straddle frame boundaries. It also can't re-serve the same source frame for two consecutive output frames (needed whenever output fps > source fps, or rate-stretched clips), because ownership of returned frames passes to the caller.
- `exportWorker.ts:89-98` keys decoders by `assetId` — two timeline objects sharing one asset would fight over a single forward-only decoder.
- `demuxMP4()` (`videoDecoder.ts:242`) holds the full compressed file + a copied sample array in memory (~2× file size). Acceptable for typical clips; should be documented as a constraint (soft-capped by the existing 50 MB per-file warning).

## Requirements

### A. Editor preview performance

- **A1. Play, don't seek**: during playback, video frames for the canvas must come from a *playing* HTMLVideoElement (with `playbackRate` set from `originalDuration / obj.duration`, clamped 0.25–4, matching current audio behaviour), rendered via a rAF loop. Seeking is only for scrubbing / jumps (drift beyond a threshold, e.g. >0.25s).
- **A2. One element per video object**: consolidate the canvas-render element and the audio element into a single `HTMLVideoElement` per video timeline object, shared between `useCanvasRenderer` and `useAudioPlayback` (or a merged hook). No double decoding.
- **A3. Decouple canvas rendering from React state**: the canvas render loop must not depend on a 60Hz React re-render of the whole app. Playback time lives in a ref/subscription; the canvas renders via its own rAF. React-rendered UI that displays time (Timeline playhead, time readout) updates at reduced frequency (~10Hz) or via direct style mutation (e.g. playhead `transform` updated outside React).
- **A4. Scrubbing stays responsive**: when paused and dragging the playhead, the canvas shows the nearest available frame immediately (current behaviour of render-then-refine-on-`seeked` is acceptable), without queuing unbounded seeks — coalesce to at most one in-flight seek per element.

### B. Export correctness + performance

- **B0. Make the decoder actually decode (the abandonment blocker).** Fix avcC/codec-description extraction in `VideoFrameSource` so `VideoDecoder.configure()` + decode succeed on the reference asset (strip the 8-byte box header — return `new Uint8Array(stream.buffer, 8)` — or manually construct the `AVCDecoderConfigurationRecord`). This is the prerequisite for B1–B3; validate it as a standalone spike (decode N frames of the reference file, confirm timestamps advance) before building on it. If mp4box cannot be made to produce a valid description, the decoder route is dead and export ships on the **B5 race-fixed fallback** instead — decide that at the spike, not after B1–B4.
- **B1. Frame-accurate sourcing**: replace HTMLVideoElement seeking in export with the sequential WebCodecs decode pipeline (`VideoFrameSource`) — resurrecting the spec-08 architecture. No seek races; every composited output frame uses the source frame whose timestamp interval covers the requested source time.
- **B2. Fix `getFrameAtTime` frame ownership**: rework `VideoFrameSource` so it *retains* the current frame (returning a reference the renderer may draw but not close; the source closes it internally when advancing or on `destroy()`). The overshoot frame must be held for the next call, never discarded. The same frame must be servable for consecutive calls with non-decreasing target times.
- **B3. Decoder per timeline object**: key decoders by object id (not asset id) so multiple clips referencing one asset each get their own sequential decoder.
- **B4. Export off the main thread**: wire up the existing `exportWorker.ts` via an `exportWithWorker()` **rewritten from the task-log description** (it was never committed — not recoverable from git; ~30 lines of `new Worker()` + postMessage glue). `vite.config.ts` already has `worker: { format: 'es' }`. Audio remains pre-rendered on the main thread (OfflineAudioContext unavailable in workers) and transferred as `RenderedAudio` (already implemented in `exportWorkerTypes.ts` / `exportWorker.ts`).
  - **B4a. Port the B2/B3 fixes into `exportWorker.ts` FIRST.** The worker still reflects the OLD caller-owned frame contract and will crash under the new source-owned one: it self-closes frames at `exportWorker.ts:151-153` (closes the previous cached frame) and `:185-188` (closes cached frames after the loop). Under B2 the `VideoFrameSource` owns and closes frames itself, so those lines are **double-frees** → `VideoFrame` "already closed" throw. Fix = delete the worker's frame-close calls (let the source own lifecycle) and key decoders/cache by **object id** (B3), i.e. mirror the main-thread changes already made in `ffmpegExport.ts`. Also fixes the `renderFrame(ctx)` type (spec 10 #7) since the worker uses `OffscreenCanvasRenderingContext2D`.
- **B8. Cancellable export** *(primary driver for doing B4 now)*: a user-visible **Cancel** aborts an in-progress export promptly. With the worker, cancel = `worker.terminate()` — decoders, encoders, and GPU frames all die with the worker thread instantly (no cooperative-checkpoint plumbing needed, and no main-thread block to fight). The export promise settles as cancelled, the UI returns to idle, and a fresh export can start. (Main-thread export can't be cleanly cancelled — it blocks the thread, so a Cancel button can't even be clicked mid-run. This is *why* cancellation needs B4.) Add a Cancel affordance to `ExportModal`; on unmount/cancel, terminate the worker.
- **B5. Graceful degradation preserved**: MediaRecorder fallback for non-WebCodecs browsers stays. Additionally, if `VideoDecoder` rejects the source codec (e.g. HEVC MP4), export must fall back to the current HTMLVideoElement path **with the seek race fixed** (always await `seeked`, no fixed 50ms timeout as a correctness mechanism — a generous watchdog, e.g. 500ms, may guard against a stuck decoder) rather than failing outright.
- **B6. No GPU memory leaks**: every `VideoFrame` closed exactly once (source-owned lifecycle from B2 makes this auditable); decoders closed on completion and on export error/cancel.
- **B7. Progress + result unchanged**: progress callback keeps working; output remains MP4 (H.264 + AAC), same muxer settings.

### C. Validation

- **C1**: The resurrected decoder pipeline must be validated against the failure modes that caused its removal (codec rejection on real-world files, decode deadlock) using at least: an iPhone-style portrait H.264 MP4 (the reference asset), a landscape screen-recording MP4, and a non-MP4/HEVC file (to prove the B5 fallback engages).
- **C2**: Visual A/B: export the reference project and verify no duplicated/stale frames (e.g. film a timer/counter video; every output frame shows a monotonically advancing counter).

## Technical Considerations

### Relevant types (all existing, in `src/types.ts` unless noted)

- `Project` — `fps: number`, `width: number`, `height: number` (defaults 30 / 1920 / 1080, `types.ts:126-128`), `objects: TimelineObject[]`.
- `VideoData` — `{ assetId: string; volume: number; originalDuration: number }`. Note: **no trim offset exists** — clip `duration` ≠ `originalDuration` means rate-stretch, not trim, so every clip always starts at source time 0 (decode-from-start is always correct; no keyframe-seek support needed yet).
- `imageCache` union (`src/lib/renderer.ts:26`): `Map<string, HTMLImageElement | HTMLVideoElement | ImageBitmap | VideoFrame>` — already `VideoFrame`-ready; `drawImageCover` already handles `displayWidth/displayHeight` via duck-typing (worker-safe).
- `ExportWorkerRequest` / `ExportWorkerResponse` / `RenderedAudio` (`src/lib/exportWorkerTypes.ts`) — complete message protocol, already matching `exportWorker.ts`.
- **Type change needed for B2/B3**: `VideoFrameSource` API changes from caller-owned frames (`getFrameAtTime(): Promise<VideoFrame | null>` + caller `.close()`) to source-owned (`getFrameAtTime(t): Promise<VideoFrame | null>` where the returned frame is valid until the next call / `destroy()`). Worker's `imageCache` handling (`exportWorker.ts:149-154`) must stop closing frames itself.
- **Type change needed for A2/A3**: whatever shape the merged media-element registry takes (e.g. `Map<objectId, MediaEntry>` where `MediaEntry.element` doubles as the canvas source) plus a playback-time subscription API (e.g. `getTime(): number` ref + `subscribe(cb)` for low-frequency UI updates).

### Architecture notes

- **Preview**: the cleanest shape is a single "media sync" hook owning one `HTMLVideoElement`/`HTMLAudioElement` per audio/video object (superset of today's `useAudioPlayback`), which exposes the elements to the canvas renderer. Canvas render becomes a rAF loop: when playing, render every frame from playing elements; when paused, render on demand (time/object changes).
- **Export**: `runExport` in `exportWorker.ts` is already ~90% of the target implementation; the work is (1) the `VideoFrameSource` ownership rework, (2) per-object decoder keying, (3) restoring `exportWithWorker()` glue, (4) fallback tiering (worker+decoder → main-thread element-seek [race-fixed] → MediaRecorder).
- **Memory**: demux-all-samples holds ~2× compressed file size in worker memory; fine under the existing `SIZE_WARN_PER_FILE` 50 MB warning. Decoded frames are bounded by the decoder backpressure window (queue ≤ 10) plus the one retained frame per clip — no unbounded frame accumulation.
- `firstTimestampBehavior: 'offset'` and stored-chunk deferred muxing carry over unchanged.

## Related Systems and Tasks

- `SPECS/08-refactor-to-webcodecs-video-export.md` — original WebCodecs design; this spec resurrects its decode side.
- `TASKS/08-webcodecs-refactor.md` — implementation log incl. the 2026-03-29 abandonment decision and the bugs that motivated it.
- `src/lib/ffmpegExport.ts` (live export), `src/lib/videoDecoder.ts` + `src/lib/exportWorker.ts` + `src/lib/exportWorkerTypes.ts` (dead but nearly-complete pipeline), `src/hooks/useCanvasRenderer.ts` + `src/hooks/useAudioPlayback.ts` + `src/hooks/usePlayback.ts` (preview), `src/lib/renderer.ts` (compositor — unchanged), `src/lib/assetStore.ts` (blob access — unchanged).

## State Machine Verification

**Not applicable — confirmed.** No status/state field with multiple writers is introduced or modified. Playback `isPlaying` is a single-writer boolean; export progress is a linear pipeline with no persisted state transitions. No event cascades write shared state.

## Open Questions

1. **Export approach confirmation**: this spec recommends resurrecting the decoder+worker pipeline (B0–B4) over merely patching the seek race (always-await-`seeked`, i.e. B5 alone, would fix "framey" but keep exports slow, ~real-time, and main-thread). The pipeline was abandoned because the decoder never decoded the reference file (malformed avcC, task-log #6) — **B0 is the bet**. If the avcC fix lands on the spike, B1–B4 is sound engineering (~75% confidence). If it can't, fall back to B5-only. Are we happy to commit to the B0 spike-first sequence? *(Recommended: yes — spike B0 before committing to B1–B4.)*
2. **Scope of A3**: full decoupling of playback time from React state is the biggest refactor in this spec. Acceptable alternative: keep 60Hz state but memoize `Timeline`/`PropertiesPanel` and throttle their time prop. Which level of investment? *(Recommended: ref-based time + rAF canvas loop; throttled 10Hz state for UI chrome.)*
3. **Worker phase ordering**: B1–B3 (decoder on main thread inside the export function) already fixes frame accuracy and most speed; B4 (worker) additionally fixes UI freeze. Ship as one piece or land B1–B3 first? *(Recommended: sequence B1–B3 → validate → B4, since worker wiring is low-risk restore-from-git.)*
4. **Preview frame source ambition**: is HTMLVideoElement (playing) good enough for preview (spec 08's "Option A"), or should preview scrubbing also move to WebCodecs eventually? *(Assumed: Option A stays; WebCodecs preview remains out of scope.)*
5. **Design ceiling**: what's the realistic max video (duration/size/count of simultaneous video clips) to design for? Current assumption: ≤50 MB per file, 1–3 video clips per project, ≤2 videos overlapping at any instant.

## Functional Requirements Checklist

Preview:
- [ ] During playback, canvas video frames come from a playing `HTMLVideoElement`; no `currentTime` assignments occur while the element plays in sync (drift ≤0.25s)
- [ ] Playing video element's `playbackRate` = `originalDuration / obj.duration`, clamped to 0.25–4
- [ ] Drift >0.25s during playback triggers a single corrective seek, not per-tick seeks
- [ ] Exactly one `HTMLVideoElement` exists per video timeline object (audio + canvas share it); asset removal / object deletion releases it
- [ ] Muted-toggle continues to affect video clips' audio (shared element keeps `muted` behaviour)
- [ ] Volume changes on a video object apply to the shared element
- [ ] Canvas renders via its own rAF loop while playing; `App` no longer re-renders at 60Hz from `globalTime`
- [ ] Timeline playhead visibly tracks playback (≥10Hz or direct-DOM) and stays draggable
- [ ] Time readout in the header keeps updating during playback
- [ ] Scrubbing while paused coalesces seeks: at most one in-flight seek per element; canvas re-renders on each `seeked`
- [ ] With the reference asset (47s, 1080×1920 MP4) on the timeline, playback holds ~30fps+ canvas updates on a typical dev machine (manual check via Performance panel — no per-tick seek storm)

Export:
- [ ] Export sources video frames via sequential `VideoDecoder` decode (no `HTMLVideoElement.currentTime` seeking on the primary path)
- [ ] Each composited output frame uses the source frame whose `[timestamp, timestamp+duration)` covers the requested source time; overshoot frames are retained, never dropped
- [ ] The same source frame is reused (not skipped, not re-decoded) for consecutive output frames when output fps exceeds source fps or clips are rate-stretched slow
- [ ] `VideoFrameSource` owns frame lifecycle: renderer never closes frames it is handed; every `VideoFrame` is closed exactly once; `destroy()` releases retained + buffered frames and the decoder
- [ ] Decoders keyed per timeline object id; two clips sharing an asset export correctly
- [ ] Export runs in the Web Worker (`exportWorker.ts`); main-thread UI remains interactive during export (progress bar animates, buttons respond)
- [ ] Audio pre-rendered on main thread and transferred to the worker as `RenderedAudio` (Transferable, zero-copy)
- [ ] Progress callbacks fire monotonically 0→1 across decode/encode/mux phases
- [ ] Unsupported-codec source (e.g. HEVC): decoder path fails over to element-seeking fallback and completes the export with a user-visible note rather than erroring
- [ ] Element-seeking fallback always awaits the `seeked` event per seek (watchdog timeout ≥500ms only as stuck-decoder escape, logged if hit)
- [ ] Non-WebCodecs browsers still fall back to MediaRecorder WebM export
- [ ] Output remains MP4 (H.264 + AAC), `fastStart: 'in-memory'`, `firstTimestampBehavior: 'offset'`
- [ ] Export of the reference project (47s portrait video + annotations) completes significantly faster than ~27s baseline and contains no duplicated/stale frame runs (counter-video A/B test)
- [ ] Export failure or cancellation closes all decoders/encoders/frames (no GPU memory growth after repeated failed exports)

## Acceptance Criteria

- Editing a project containing the reference video (18.7 MB, 1080×1920, 47s) feels responsive: smooth playback, responsive scrubbing, no multi-second UI stalls.
- Exporting that project immediately after import produces smooth, frame-accurate MP4 output — no janky/framey duplicated-frame artifacts — while the UI stays usable.
- No regressions for photo/annotation-only projects (preview and export identical to today).
- No GPU/heap memory leaks across repeated exports and long editing sessions.

## Implementation Notes

Suggested sequencing (each phase independently shippable):

1. **Preview: play-based rendering + element consolidation** (A1, A2, A4) — merge `useAudioPlayback`'s element registry with `useCanvasRenderer`'s cache; add play/pause/rate sync for the canvas path; biggest perceived-perf win for least risk.
2. **Preview: render-loop decoupling** (A3) — rAF canvas loop reading a time ref; throttle React time updates; direct-DOM playhead if needed.
3. **Export: decoder resurrection on main thread** (B1–B3, B5, B6) — rework `VideoFrameSource` ownership (retain-current-frame API), fix overshoot-drop, key by object id, integrate into `exportWithWebCodecs()` replacing element seeking; fix the fallback's seek race while there.
4. **Export: worker wiring** (B4) — rewrite `exportWithWorker()` from the task-log description (never committed; not in git); `exportWorker.ts` needs only the updated `VideoFrameSource` API + per-object keying; `vite.config.ts` already has `worker: { format: 'es' }`.
5. **Validation pass** (C1, C2) — codec matrix + counter-video A/B.

Patterns to follow: existing backpressure loops (`decodeQueueSize`/`encodeQueueSize` ≤ 10); stored-chunk deferred muxing; duck-typed dimension detection in `drawImageCover` for worker safety.
