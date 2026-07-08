# 09 - In-Video Performance (preview + export)

**Status**: In Progress

## Overview

Adding a video asset tanks performance in two places: (1) editor preview playback is super choppy (seek-storm rendering + double-decoded elements + 60Hz whole-app re-render), and (2) export produces "framey"/duplicated-frame output and freezes the UI (racing HTMLVideoElement seeks on the main thread). Full diagnosis and plan: [SPECS/09-in-video-perf.md](../SPECS/09-in-video-perf.md).

The export fix hinges on resurrecting the abandoned WebCodecs `VideoDecoder` pipeline. That pipeline was dropped in spec 08 because it **never decoded the reference file** — task-log issue #6, `Failed to parse avcC` (malformed codec description bytes from mp4box). That blocker is unaddressed by the rest of the plan, so **before** committing to the export refactor (B1–B4) we run a spike (B0) to prove the decoder can decode at all.

## Task Context

- **Spec**: [SPECS/09-in-video-perf.md](../SPECS/09-in-video-perf.md) — see requirement **B0** and the ⚠️ Primary-risk callout.
- **Prior art / why it was abandoned**: [TASKS/08-webcodecs-refactor.md](08-webcodecs-refactor.md), Blockers §6 (`Failed to parse avcC`).
- **Hypothesis under test**: `getCodecDescription()` ([videoDecoder.ts:324-336](../src/lib/videoDecoder.ts#L324-L336)) returns `stream.buffer.slice(0, getPosition())`, which **keeps the 8-byte MP4 box header** (`[size]['avcC']`) in front of the `AVCDecoderConfigurationRecord`. The canonical mp4box→WebCodecs pattern returns `new Uint8Array(stream.buffer, 8)` (header stripped). Suspected one-line cause of the avcC parse failure.
- **Decoder pipeline (dead code, reused by spike)**: [src/lib/videoDecoder.ts](../src/lib/videoDecoder.ts) — `VideoFrameSource`, `demuxMP4`, mp4box imports.
- **Asset access**: `getAssetBlob(id)` in [src/lib/assetStore.ts](../src/lib/assetStore.ts).
- **Spike must be isolated/throwaway** — it does its own mp4box demux and A/B-tests description strategies directly; it does NOT modify `videoDecoder.ts`. The production fix (B0 proper) is applied only after the spike tells us which strategy works.
- **CTS offset (found by spike)**: decoded frames on the reference file start at `frame.timestamp` = 66,660µs (H.264 B-frame reorder / CTS offset), not 0. B2's frame-lookup must anchor requested source-time 0 to the *first available* frame rather than expecting a frame at exactly 0 — otherwise the clip's opening frames get skipped.

## Blockers/Issues

- **avcC parse failure — ✅ RESOLVED (2026-07-07 spike).** Root cause confirmed: `getCodecDescription` kept the 8-byte MP4 box header in the decoder `description`. Spike verdict on the reference asset (`avc1.640032`, 1080×1920, 1407 samples): strategies A & D (full box) FAIL "Failed to parse avcC"; B & C (header stripped) PASS, 12 frames, timestamps advancing at 30fps. Codec-string normalization was irrelevant (A≡D, B≡C). Fix = strip the first 8 bytes (`new Uint8Array(stream.buffer, 8)`). **Decoder route is viable — green-light B1–B4.**

## TODO

- [ ] **B0 spike**: standalone WebCodecs decode probe that A/B-tests avcC extraction strategies against the reference asset
  - [X] `src/lib/decoderSpike.ts` — demux + 4-strategy decode probe + verdict logging
  - [X] Console trigger `window.__spike()` wired from `App.tsx` (finds first video object's blob)
  - [X] Verified: `npx vite build` bundles clean (54 modules); spike file type-clean
  - [X] Run against reference asset — verdict: **header-strip fixes decode (B & C pass, A & D fail)**
  - [X] **Decided**: green-light B1–B4 (decoder route viable)
- [X] **B0 proper**: strip 8-byte header in `getCodecDescription` (`videoDecoder.ts`)
- [X] **B2**: reworked `VideoFrameSource` to source-owned frames (retain current, re-serve, never drop overshoot; anchors source-time 0 → first frame via `frameEndUs`)
- [X] **B3**: decoders keyed per timeline-object id; decoded frames cached by object id; renderer prefers object-id key, falls back to asset-id
- [X] **B1**: `exportWithWebCodecs()` sources via `VideoFrameSource.getFrameAtTime()` — no `HTMLVideoElement.currentTime` seeking on the primary path
- [X] **B5/B6**: per-clip element fallback with race-fixed `awaitSeeked` (always awaits `seeked`, 500ms watchdog); sources destroyed on success AND on error (try/catch), frames closed exactly once by the source
- [X] Type-clean (`tsc`) for `videoDecoder.ts` / `ffmpegExport.ts` / `renderer.ts`; `vite build` passes
- [X] **Manual verify** (user-confirmed): export smooth/frame-accurate, no framey runs, and noticeably faster
- [X] **B4a**: ported B2/B3 into `exportWorker.ts` — decoders keyed per object id, removed the double-free frame-close calls (source owns frames), OffscreenCanvas ctx cast, recoverable-error signalling for the no-element-fallback case
- [X] **B4**: `exportWithWorker()` glue in `ffmpegExport.ts` — audio pre-rendered on main thread + transferred as `RenderedAudio`, blobs passed, progress/done/error wired; tiers worker → main-thread decoder (element fallback) → MediaRecorder; build emits a separate 223 kB worker chunk
- [X] **B8**: cancellable export — `AbortSignal` → `worker.terminate()`; Cancel button in `ExportModal` (main-thread paths also poll the signal); user-cancel swallowed (not shown as error)
- [X] **Manual verify B4/B8** (user-confirmed): export runs with the UI responsive; Cancel aborts promptly; output correct
- [X] **A1/A2**: canvas draws from the shared PLAYING element (via `mediaRegistry`) instead of a seek-storming muted duplicate — kills the seek-storm AND the double-decode
- [X] **A3 (partial)**: canvas renders via its own rAF loop while playing, reading a time ref — decoupled from React's 60Hz state. (Remaining if still janky: throttle Timeline/PropertiesPanel re-renders.)
- [X] **A4**: paused scrubbing renders on demand + redraws when the shared element's seek settles
- [X] **Manual verify preview** (user-confirmed): playback smooth, no seconds-long canvas freeze
- [ ] (maybe) A3 full: throttle 60Hz React state for UI chrome if timeline/panel still feel janky
- [X] Remove spike scaffolding — deleted `src/lib/decoderSpike.ts` + reverted the `App.tsx` trigger and its imports
- [ ] (separate tickets) `SPECS/10-typescript-build-fixes.md` (green `npm run build`), `SPECS/11-audio-pitch-on-rate-change.md` (export chipmunk audio)

## Work Log

[2026-07-07] Created task. Built the B0 spike: `src/lib/decoderSpike.ts` (self-contained mp4box demux + 4-strategy `VideoDecoder` probe: full-box vs stripped-header × original vs normalized codec string) and a `window.__spike()` console trigger installed from `App.tsx`. Verified with `npx vite build` (54 modules, clean bundle). Note: repo `tsc -b` has PRE-EXISTING errors (Canvas.tsx, ImportModal.tsx, videoDecoder.ts, exportWorker.ts, App.tsx AssetMeta-unused + line 104) unrelated to this change; dev server (esbuild) is unaffected. Spike is throwaway — does not modify `videoDecoder.ts`.
- Files created: `src/lib/decoderSpike.ts`
- Files modified: `src/components/App.tsx`

[2026-07-07] Implemented B4 + B4a + B8 (export off the main thread, cancellable). Ported B2/B3 into `exportWorker.ts` (per-object decoders, removed the frame-close double-frees, OffscreenCanvas ctx cast, `RecoverableExportError` for codec-reject). Added `exportWithWorker()` in `ffmpegExport.ts`: pre-renders audio on the main thread → transfers `RenderedAudio`, spawns `new Worker(new URL('./exportWorker.ts', import.meta.url), {type:'module'})`, wires progress/done/error, and on a recoverable error falls back to the main-thread `exportWithWebCodecs` (which keeps the per-clip element fallback). `exportVideo` now tiers worker → main-thread decoder → MediaRecorder and takes an `AbortSignal`. Cancellation: `useFFmpegExport` owns an `AbortController`; `exportWithWorker` terminates the worker on abort; `ExportModal`'s left button becomes "Cancel export" during a run. `tsc` clean on touched files; `vite build` emits a separate 223 kB worker chunk.
- Files modified: `src/lib/exportWorker.ts`, `src/lib/exportWorkerTypes.ts`, `src/lib/ffmpegExport.ts`, `src/hooks/useFFmpegExport.ts`, `src/components/ExportModal.tsx`
- Note: this is the FIRST successful-build wiring of the worker since spec 08 abandoned it — runtime not yet exercised end-to-end.

[2026-07-07] Removed the B0 spike scaffolding now that the fix is in the real pipeline: deleted `src/lib/decoderSpike.ts` and reverted the `App.tsx` `window.__spike` trigger + the `getAssetBlob`/`VideoData` imports added for it. `vite build` still passes; no new tsc errors. Also filed two follow-up specs: `SPECS/10-typescript-build-fixes.md` (pre-existing `npm run build` type errors) and `SPECS/11-audio-pitch-on-rate-change.md` (export resamples audio → pitch shifts on rate-stretch, while preview preserves pitch). Extended `SPECS/09` B4 with B4a (port B2/B3 into the worker to avoid double-free) and B8 (cancellable export via `worker.terminate()`).
- Files deleted: `src/lib/decoderSpike.ts`
- Files modified: `src/components/App.tsx`
- Specs created: `SPECS/10-typescript-build-fixes.md`, `SPECS/11-audio-pitch-on-rate-change.md`

[2026-07-07] Implemented the preview fix (A1 + A2 + A4 + partial A3). New `src/lib/mediaRegistry.ts` holds one HTMLVideoElement per video object. `useAudioPlayback` now registers its (playing) video elements there + sets `playsInline`. `useCanvasRenderer` rewritten: deleted the per-tick seek-storm and its duplicate muted video elements; instead it draws the shared playing element's current frame via a rAF loop while playing (decoupled from React 60Hz, reads a time ref), renders on demand while paused, and redraws on `seeked` for scrubbing. `isPlaying` threaded App → Canvas → useCanvasRenderer. Net: asset decoded once, canvas advances by playback (not seeking). `vite build` passes.
- Files created: `src/lib/mediaRegistry.ts`
- Files modified: `src/hooks/useCanvasRenderer.ts`, `src/hooks/useAudioPlayback.ts`, `src/components/Canvas.tsx`, `src/components/App.tsx`

[2026-07-07] Implemented the export decoder path (B0 proper + B1 + B2 + B3 + B5 + B6). `getCodecDescription` now strips the 8-byte header. `VideoFrameSource` reworked to source-owned frame lifecycle (`currentFrame` retained + re-served, overshoot never dropped, `frameEndUs` anchors source-time 0 → first frame, `destroy()` closes it). `exportWithWebCodecs()` now builds one `VideoFrameSource` per video object (keyed by object id), sources frames via `getFrameAtTime()` instead of element seeking, falls back per-clip to race-fixed `awaitSeeked` element seeking if the decoder rejects the codec (B5), and destroys all sources on success and on error (B6). `renderer.ts` video case prefers the object-id cache key, falls back to asset-id (keeps preview working). Also fixed videoDecoder.ts's own pre-existing tsc errors (never-narrowing, BIG_ENDIAN) since it's now load-bearing. `vite build` passes; touched files type-clean.
- Files modified: `src/lib/videoDecoder.ts`, `src/lib/ffmpegExport.ts`, `src/lib/renderer.ts`
- Not done: B4 (worker) — `exportWorker.ts` still self-closes frames (double-close vs new contract); to fix when wiring B4.

[2026-07-07] Ran the spike in-browser on the reference asset. **Verdict: header-strip fixes decode.** demux OK (1407 samples, `avc1.640032`, 1080×1920). Strategies A (full box + original codec) and D (full box + normalized codec) FAILED at decode with "Failed to parse avcC"; B (stripped + original) and C (stripped + normalized) PASSED — 12 frames, timestamps `66660, 99990, 133320, …` (monotonic, ~33.3ms = 30fps). Conclusion: the 8-byte box header was the sole cause; codec normalization is irrelevant. Spec-08 blocker #6 is retired. Also observed first-frame CTS = 66,660µs (B-frame reorder offset) — noted for B2. Decoder route green-lit; next is B0 proper + B1–B3.
