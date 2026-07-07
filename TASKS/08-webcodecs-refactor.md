# 08 - Refactor to WebCodecs Video Export

**Status**: In Progress

## Overview

Replace the current MediaRecorder export pipeline with WebCodecs VideoEncoder + mp4-muxer for faster MP4 export. Video frames sourced via HTMLVideoElement seeking (same as preview). Compositing via Canvas2D (renderFrame) unchanged.

## Task Context

- **Spec**: See [SPECS/08-refactor-to-webcodecs-video-export.md](../SPECS/08-refactor-to-webcodecs-video-export.md) for full spec with resolved questions
- **Current export pipeline**: `src/lib/ffmpegExport.ts` uses MediaRecorder + captureStream → WebM. Real-time bound (setTimeout per frame). Video frames sourced via HTMLVideoElement seeking (approximate, not frame-accurate)
- **Renderer**: `src/lib/renderer.ts` — `renderFrame()` composites all object types onto a Canvas2D context. Must keep working as-is. Only change: imageCache type union adds `VideoFrame`, and `drawImageCover` needs VideoFrame dimension handling (`.displayWidth`/`.displayHeight`)
- **Preview**: `src/hooks/useCanvasRenderer.ts` — stays on HTMLVideoElement seeking for now (Option A from spec)
- **Asset store**: `src/lib/assetStore.ts` — `getAssetBlob(id)` provides raw Blobs for demuxing
- **Export hook**: `src/hooks/useFFmpegExport.ts` — triggers export, handles progress/download. Currently downloads `.webm`
- **Export modal**: `src/components/ExportModal.tsx` — hard-coded to show "WebM (VP9)" format
- **Types**: `src/types.ts` — TimelineObject, VideoData, PhotoData, AudioData, Project
- **FFmpeg deps**: `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util` are in package.json but **completely unused** — safe to remove
- **New deps needed**: `mp4box` (demux), `mp4-muxer` (mux MP4 output)
- **Worker considerations**: `renderFrame()` uses Canvas2D which works on OffscreenCanvas. Need to make renderer importable from worker context (no DOM deps). Worker communicates via postMessage for progress updates + final blob.
- **Web Worker API availability**: `OfflineAudioContext` is NOT available in workers. `VideoEncoder`, `VideoDecoder`, `AudioEncoder`, `OffscreenCanvas`, `createImageBitmap` ARE available.
- **mp4box callback rule**: NEVER use `async` functions as mp4box callbacks (`onReady`, `onSamples`). mp4box calls them synchronously and doesn't await — any `await` creates race conditions.
- **WebCodecs codec config**: `VideoDecoder.isConfigSupported()` is unreliable — use `configure()` directly with try/catch. `VideoEncoder.isConfigSupported()` works fine for encoding. H.264 decoder always needs the `description` field (avcC bytes).
- **mp4-muxer note**: `mp4-muxer` is deprecated in favor of `mediabunny` — works fine for now but may need migration later.

## Blockers/Issues

### Resolved Issues

**1. `OfflineAudioContext is not defined` in Web Worker**
- **Problem**: `OfflineAudioContext` is not available in Web Worker scope in all browsers. The worker crashed immediately on export.
- **Root cause**: We assumed all Web Audio API was available in workers — it isn't universally.
- **Fix**: Moved audio pre-rendering to the main thread. Main thread runs `OfflineAudioContext`, extracts raw `Float32Array` channel data, transfers to worker via zero-copy (`Transferable`). Worker only does `AudioEncoder` encoding.
- **Files**: `ffmpegExport.ts`, `exportWorker.ts`, `exportWorkerTypes.ts`

**2. `Codec avc1.4d0420 not supported by this browser`**
- **Problem**: `VideoDecoder.isConfigSupported()` rejected the H.264 codec string from the source MP4 file, even though the codec is perfectly valid and the browser can play it in `<video>`.
- **Root cause**: The codec string from the MP4 container includes constraint flags (e.g. `avc1.4d0420` where `04` = constraint_set2_flag). `isConfigSupported()` is stricter than `configure()` and rejects these. Our fallback Strategy 3 (configure without description bytes) was accepted by `isConfigSupported` but then failed at decode time because H.264 requires the description field (avcC box).
- **Fix**: Replaced `isConfigSupported()` + `configure()` with direct `configure()` wrapped in try/catch. Strategy 1 tries exact codec string + description, Strategy 2 normalizes constraint flags to `00`. Removed Strategy 3 (no description) entirely — H.264 always needs it.
- **Insight**: `isConfigSupported()` is overly strict in some browsers. Many WebCodecs examples skip it entirely and just call `configure()` directly. `configure()` is synchronous and throws if unsupported — try/catch is sufficient.
- **Files**: `videoDecoder.ts`

**3. Encoder codec `avc1.640028` not supported**
- **Problem**: We hardcoded H.264 High Profile Level 4.0 (`avc1.640028`) for the encoder, which isn't available on all hardware.
- **Fix**: Added `findSupportedVideoCodec()` in the worker that tries 6 H.264 profile/level combos from High→Baseline, Level 4.0→3.0, using `VideoEncoder.isConfigSupported()` (which works reliably for encoding, unlike decoding).
- **Files**: `exportWorker.ts`

**4. Export stuck at 0% — decoder deadlock**
- **Problem**: After fixing the codec error, export would sometimes hang at 0% progress with no error.
- **Root cause**: `mp4File.onSamples` was an `async` callback. mp4box calls it synchronously from `start()`, the callback yielded at `await configureDecoder()`, and mp4box's internal state got confused. Multiple `onSamples` calls could interleave because the async function yielded control between awaits, causing a deadlock where no frames were ever produced.
- **Fix**: Completely rewrote `VideoFrameSource` with a two-phase architecture:
  - **Phase 1 (Demux)**: `demuxMP4()` parses the entire MP4 synchronously. `onSamples` is a plain synchronous function that just copies encoded sample data into an array. No async, no race conditions.
  - **Phase 2 (Decode)**: `feedDecoder()` runs as a separate async background task after `init()` completes, feeding collected samples to `VideoDecoder` one at a time with backpressure.
- **Insight**: Never use `async` functions as mp4box callbacks. mp4box calls them synchronously from within `appendBuffer()`/`start()`/`flush()` and doesn't await the returned Promise. Any `await` inside the callback creates a race condition.
- **Files**: `videoDecoder.ts`

**5. `drawImageCover` crashes in Web Worker — `HTMLVideoElement is not defined`**
- **Problem**: `instanceof HTMLVideoElement` throws `ReferenceError` in a Web Worker where DOM globals don't exist.
- **Fix**: Replaced `instanceof` checks with duck-typing: `'videoWidth' in img` instead of `img instanceof HTMLVideoElement`.
- **Files**: `renderer.ts`

**6. `VideoDecoder error: Failed to parse avcC`**
- **Problem**: Even after fixing codec string issues, the avcC description bytes extracted via mp4box `DataStream` serialization were malformed, causing the decoder to reject them.
- **Decision**: Dropped VideoDecoder entirely. It was an optimization for frame accuracy — HTMLVideoElement seeking is "good enough" and proven reliable. All decoder-related bugs were eliminated by this decision.

### Current Status

**Export is working.** Simplified architecture: WebCodecs VideoEncoder + mp4-muxer on main thread, HTMLVideoElement seeking for video frames (no VideoDecoder, no Web Worker).

**Performance**: 60-second video clip with 3 pen annotations exports in ~27 seconds. The old MediaRecorder pipeline would take 60+ seconds (real-time bound). So roughly a 2x speedup, but short of the spec's 5-20x target.

**Performance bottleneck**: HTMLVideoElement seeking. Each frame requires `video.currentTime = X` which triggers an internal decode from the nearest keyframe. Even with optimizations (skip seeks when already close, tiered seek strategy), seeking dominates export time. The proper fix is VideoDecoder (sequential decode is much faster than random-access seeking), but that was dropped due to mp4box avcC serialization bugs.

### Potential future improvements (not started)
- **VideoDecoder revival**: The avcC description bytes from mp4box were malformed. Could try: (a) a different demuxer like `web-demuxer` (WASM-based, Bilibili), (b) manually constructing avcC bytes instead of using mp4box's DataStream serialization, (c) using `mediabunny` which may have better demux support
- **Web Worker revival**: Once VideoDecoder works, can move back to worker (no HTMLVideoElement dependency)
- **`video.play()` + `requestVideoFrameCallback`**: Instead of seeking frame-by-frame, play the video and capture frames as they decode. Browser's internal decoder is optimized for sequential playback. Would be faster than seeking but adds complexity around synchronizing capture with the export timeline.

## TODO

### Completed

- [X] **VideoEncoder + mp4-muxer pipeline** — replaces MediaRecorder, outputs MP4 (H.264 + AAC), no real-time delay
- [X] **Audio encoding** — OfflineAudioContext pre-render → AudioEncoder (AAC-LC) → mp4-muxer
- [X] **H.264 codec negotiation** — tries 6 profile/level combos via `isConfigSupported()`
- [X] **MediaRecorder fallback** — for browsers without WebCodecs (outputs WebM)
- [X] **UI updates** — ExportModal shows MP4, hook downloads .mp4/.webm based on blob type
- [X] **Renderer updates** — imageCache type includes VideoFrame, drawImageCover uses duck-typing for worker compat
- [X] **Dependency cleanup** — removed unused @ffmpeg/*, added mp4box + mp4-muxer
- [X] **Seek optimization** — tiered seeking: large jumps (full seek+wait), small advances (set+yield), already-there (skip)

### Outstanding

- [ ] **Verify audio export** — test with audio clips and video clips that have audio tracks
- [ ] **Verify visual correctness** — confirm annotations render identically to preview in exported MP4
- [ ] **Clean up unused files** — `videoDecoder.ts`, `exportWorker.ts`, `exportWorkerTypes.ts` are dead code (kept for reference but should be removed or moved before shipping)
- [ ] **Performance** — 60s video exports in ~27s. Acceptable for now but could be improved (see "Potential future improvements" in Blockers section)

## Work Log

[2026-03-28] Phase 1: Created video decoder pipeline
- Installed `mp4box` dependency
- Created `src/lib/videoDecoder.ts` — `VideoFrameSource` class that demuxes MP4 blobs via MP4Box.js and decodes frames via WebCodecs `VideoDecoder`
- Features: sequential frame access (`nextFrame()`), time-based access (`getFrameAtTime()`), backpressure handling (decodeQueueSize > 10 threshold), proper cleanup (`destroy()`)
- Uses `MP4BoxBuffer.fromArrayBuffer()` for typed buffer creation, `DataStream` for codec description extraction
- Files created: `src/lib/videoDecoder.ts`
- Files modified: `package.json`, `package-lock.json`

[2026-03-28] Phases 2-4 + 6: Complete WebCodecs export pipeline
- Installed `mp4-muxer`, removed `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`
- Rewrote `src/lib/ffmpegExport.ts`: new `exportWithWebCodecs()` pipeline using VideoEncoder + AudioEncoder + mp4-muxer, with `exportWithMediaRecorder()` fallback. Collects encoded chunks then muxes (mp4-muxer needs audio config at construction). No more setTimeout real-time delay.
- Updated `src/lib/renderer.ts`: imageCache type union now includes `VideoFrame`, `drawImageCover` handles `VideoFrame.displayWidth/displayHeight`
- Updated `src/hooks/useFFmpegExport.ts`: removed format param, downloads `.mp4` or `.webm` based on blob type
- Updated `src/components/ExportModal.tsx`: shows "MP4 (H.264)" format, "Export MP4" button
- Files modified: `src/lib/ffmpegExport.ts`, `src/lib/renderer.ts`, `src/hooks/useFFmpegExport.ts`, `src/components/ExportModal.tsx`, `package.json`, `package-lock.json`

[2026-03-28] Phase 5: Web Worker export pipeline
- Created `src/lib/exportWorkerTypes.ts` — message protocol types (ExportWorkerRequest, ExportWorkerResponse)
- Created `src/lib/exportWorker.ts` — full WebCodecs pipeline running in a Web Worker: loads photos as ImageBitmap via createImageBitmap(), decodes video via VideoFrameSource, renders on OffscreenCanvas, encodes + muxes to MP4, sends progress/done/error messages back to main thread
- Refactored `src/lib/ffmpegExport.ts` — `exportWithWorker()` spawns worker, sends project + asset blobs, listens for progress/done/error. MediaRecorder fallback stays on main thread.
- Fixed `src/lib/renderer.ts` — `drawImageCover` now uses duck-typing (`'videoWidth' in img`) instead of `instanceof HTMLVideoElement` so it works in Web Workers where DOM globals don't exist
- Updated `vite.config.ts` — removed stale ffmpeg optimizeDeps, added `worker: { format: 'es' }`
- Build output: worker is a separate chunk (223KB), main bundle back to 351KB
- Files created: `src/lib/exportWorker.ts`, `src/lib/exportWorkerTypes.ts`
- Files modified: `src/lib/ffmpegExport.ts`, `src/lib/renderer.ts`, `vite.config.ts`

[2026-03-29] Fix: OfflineAudioContext not available in Web Workers
- Moved audio pre-rendering (OfflineAudioContext) from worker to main thread
- Main thread renders audio mix, extracts Float32Array channel data, transfers to worker via zero-copy (Transferable)
- Added `RenderedAudio` type to `exportWorkerTypes.ts` for the audio data payload
- Worker now receives pre-rendered audio and only does the AudioEncoder encoding
- Files modified: `src/lib/ffmpegExport.ts`, `src/lib/exportWorker.ts`, `src/lib/exportWorkerTypes.ts`

[2026-03-29] Fix: H.264 encoder codec negotiation
- Added `findSupportedVideoCodec()` in `exportWorker.ts` — tries 6 H.264 profile/level combos (High→Baseline, Level 4.0→3.0) via `VideoEncoder.isConfigSupported()` instead of hardcoding `avc1.640028`
- Files modified: `src/lib/exportWorker.ts`

[2026-03-29] Fix: VideoDecoder codec rejection + deadlock rewrite
- **Decoder codec fix**: Replaced `isConfigSupported()` with direct `configure()` + try/catch in `configureDecoder()`. Strategy 1: exact codec+description, Strategy 2: normalized constraint flags. Removed Strategy 3 (no description) — H.264 requires it.
- **Deadlock fix**: Completely rewrote `VideoFrameSource` with two-phase architecture. Phase 1: synchronous demux collects all encoded samples into an array (no async mp4box callbacks). Phase 2: `feedDecoder()` runs as separate async background task feeding samples to VideoDecoder with backpressure. Eliminates the async callback race condition.
- Files modified: `src/lib/videoDecoder.ts`

[2026-03-29] Simplification: Drop VideoDecoder + Web Worker, keep VideoEncoder
- Dropped VideoDecoder (mp4box demux + WebCodecs decode) — source of all bugs. HTMLVideoElement seeking works reliably for sourcing video frames.
- Dropped Web Worker — HTMLVideoElement needs DOM, so export runs on main thread.
- Rewrote `src/lib/ffmpegExport.ts` to simple architecture: HTMLVideoElement seeking + Canvas2D compositing + VideoEncoder + mp4-muxer. No more VideoDecoder, no worker, no exportWorkerTypes.
- Worker files (`exportWorker.ts`, `exportWorkerTypes.ts`) and decoder (`videoDecoder.ts`) are now unused but kept for potential future use.
- Single bundle output at 386KB (no worker chunk).
- Files modified: `src/lib/ffmpegExport.ts`

[2026-03-29] Seek optimization + successful export test
- Added tiered seeking in `exportWithWebCodecs()`: large jumps (>0.5s) do full seek+wait, small sequential advances (>10ms) just set currentTime + yield with setTimeout(0), already-there (<10ms) skips entirely.
- **First successful export**: 60-second MP4 video clip with 3 pen annotations → exports to MP4 in ~27 seconds. Previously would have taken 60+ seconds with old MediaRecorder real-time pipeline.
- HTMLVideoElement seeking is now the clear bottleneck (~27s of the export is seek time). Encoding/muxing is fast.
- Files modified: `src/lib/ffmpegExport.ts`
