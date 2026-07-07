# 08 - Refactor to WebCodecs Video Export

## Overview

Replace the current HTMLVideoElement-seeking + MediaRecorder export pipeline with WebCodecs API (`VideoDecoder` / `VideoEncoder`) for dramatically faster, frame-accurate video export. Output MP4 (H.264 + AAC). Run the export pipeline in a Web Worker with OffscreenCanvas for full UI responsiveness.

The existing compositing system (`renderFrame` in `renderer.ts`) which handles all annotation types (arrows, text, shapes, freehand, photos) composited via Canvas2D must continue working unchanged — this refactor only replaces how video frames are sourced and how the final output is encoded.

## Requirements

### 1. Replace Video Frame Sourcing (Decode Side)

**Current approach:** `HTMLVideoElement` + `video.currentTime = X` + `await seeked` event + `ctx.drawImage(video)`. Slow because each seek may decode up to 30 frames internally (GOP size).

**New approach:**
- Demux source MP4 files using MP4Box.js
- Decode frames sequentially using `VideoDecoder` → `VideoFrame` objects
- Pass `VideoFrame` directly to `ctx.drawImage(videoFrame, ...)` (it's a valid `CanvasImageSource`)
- Call `frame.close()` after every draw to release GPU memory

This applies to:
- **Export** (`ffmpegExport.ts`): frame-by-frame rendering of video clips
- **Live preview** (`useCanvasRenderer.ts`): scrubbing through the timeline

### 2. Replace Output Encoding (Encode Side)

**Current approach:** `canvas.captureStream(0)` + `MediaRecorder` → WebM blob. Constrained to real-time encoding speed due to `setTimeout(1000/fps)` per frame.

**New approach:**
- Create `VideoFrame` from composited canvas: `new VideoFrame(canvas, { timestamp })`
- Encode with `VideoEncoder` → `EncodedVideoChunk` objects
- Mux with **mp4-muxer** to produce MP4 file
- No real-time constraint — encode as fast as the hardware allows (5-20x faster than real-time)

### 3. Preserve All Existing Compositing

The `renderFrame()` function in `renderer.ts` must continue to work exactly as it does today. It composites:
- Photos (from asset store)
- Arrows (animated, bezier curves)
- Text (animated character reveal)
- Rectangles and circles (animated)
- Freehand strokes (animated)
- Video clips (drawn via `ctx.drawImage`)
- Ghost previews in editor mode

The only change is **what gets passed in the `imageCache` for video objects**: instead of `HTMLVideoElement`, it will be a `VideoFrame` (which is also a valid `CanvasImageSource` and also has `.codedWidth` / `.codedHeight` similar to `videoWidth` / `videoHeight`).

### 4. Audio Mixing Unchanged

The `OfflineAudioContext` pre-render approach for audio mixing should remain as-is. It already works independently of the video pipeline — it decodes audio from blobs, mixes at correct volumes/rates, and renders to a buffer. The only integration point is how the final audio gets muxed into the output:

- **Current:** Audio buffer → `AudioContext` → `MediaStreamAudioDestinationNode` → combined `MediaStream` → `MediaRecorder`
- **New:** Audio buffer → encode with `AudioEncoder` (or directly mux PCM) → muxer alongside video chunks

### 5. Output Format

MP4 (H.264 + AAC) is the only output format. Universally compatible, better for sharing. WebM output can be added later via `webm-muxer` if needed.

### 6. Graceful Fallback

If WebCodecs is not available (older browsers, ~5% of users), fall back to the current MediaRecorder approach. Feature-detect with:
```typescript
const hasWebCodecs = typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined'
```

## Technical Considerations

### Demuxer Selection

**MP4Box.js** — MP4 demuxing only.
- Mature, widely used, JS-native (no WASM)
- Generates `VideoDecoderConfig` and `EncodedVideoChunk` compatible with WebCodecs
- Used in official W3C WebCodecs samples
- ~50KB gzipped

Can expand to multi-format demuxing (web-demuxer) or local format conversion later if needed.

### Muxer Selection

**mp4-muxer** — npm package, produces MP4 with H.264 video + AAC audio. Accepts `EncodedVideoChunk` / `EncodedAudioChunk` from WebCodecs directly.

### New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `mp4box` | Demux MP4 source videos | ~50KB gz |
| `mp4-muxer` | Mux MP4 output | ~15KB gz |

Remove unused FFmpeg deps: `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`

### TypeScript Types

**Existing types — no changes needed:**
```typescript
// src/types.ts
type VideoData = {
  assetId: string
  volume: number
  originalDuration: number
}

type PhotoData = {
  assetId: string
}

// src/lib/renderer.ts
function renderFrame(
  ctx: CanvasRenderingContext2D,
  objects: TimelineObject[],
  globalTime: number,
  options: { width: number; height: number },
  imageCache: Map<string, HTMLImageElement | HTMLVideoElement | ImageBitmap>,
  editorOptions?: EditorOptions,
)
```

**Key renderer type change:** The `imageCache` map value type needs to include `VideoFrame`:
```typescript
// Before
imageCache: Map<string, HTMLImageElement | HTMLVideoElement | ImageBitmap>
// After
imageCache: Map<string, HTMLImageElement | HTMLVideoElement | ImageBitmap | VideoFrame>
```

`VideoFrame` is a valid `CanvasImageSource` so `ctx.drawImage(videoFrame, ...)` works. But `drawImageCover` needs to handle `VideoFrame` dimensions:
```typescript
// VideoFrame uses .displayWidth / .displayHeight (not .width/.height or .videoWidth/.videoHeight)
const imgW = img instanceof VideoFrame ? img.displayWidth
           : img instanceof HTMLVideoElement ? img.videoWidth
           : img.width
```

**New types to create:**
```typescript
// Decoded frame cache: maps assetId → array of decoded VideoFrames indexed by frame number
type DecodedFrameCache = Map<string, VideoFrame[]>

// Or a sliding window approach for memory efficiency:
type FrameCache = Map<string, {
  frames: Map<number, VideoFrame>  // frameIndex → VideoFrame
  decoder: VideoDecoder
  // ... demuxer state
}>
```

### Export Pipeline Architecture (New)

```
Phase 1: Pre-decode all video clips
  [Asset Blob] → [Demuxer (MP4Box)] → [EncodedVideoChunk[]] → [VideoDecoder] → [VideoFrame[]]
  Store decoded frames in a Map<assetId, Map<frameIndex, VideoFrame>>

Phase 2: Pre-render audio mix (unchanged)
  [Audio/Video Blobs] → [OfflineAudioContext] → [AudioBuffer]

Phase 3: Frame-by-frame compositing + encoding
  For each output frame:
    1. Look up correct VideoFrame for each active video clip
    2. Put it in imageCache
    3. Call renderFrame() — composites ALL objects (photos, arrows, text, video frames, etc.)
    4. new VideoFrame(canvas, { timestamp }) → VideoEncoder
    5. Close the canvas VideoFrame

  AudioEncoder encodes the pre-rendered audio buffer in parallel

Phase 4: Mux
  [EncodedVideoChunks + EncodedAudioChunks] → [mp4-muxer] → [Blob]
```

### Live Preview Pipeline (Scrubbing)

For the editor preview, we have two approaches:

**Option A: Keep HTMLVideoElement seeking for preview** (simpler)
- Only use WebCodecs for export
- Preview scrubbing stays as-is (good enough for interactive use)
- Avoids complexity of managing VideoDecoder lifecycle during editing

**Option B: Use VideoDecoder for preview too** (better UX)
- Sequential decode is fast when scrubbing forward
- Need to handle backward scrubbing (seek to keyframe + decode forward)
- More complex lifecycle management (decoder per clip, pause/resume)

**Recommendation:** Option A for initial implementation. Preview seeking is "good enough" — the user sees the approximate frame. The big win is export speed.

### Memory Management

`VideoFrame` objects hold GPU memory and MUST be closed after use via `frame.close()`. Failing to close them causes GPU memory leaks that crash the tab.

For export:
- Pre-decoding all frames of a long video into memory is not viable (a 60s 1080p clip at 30fps = 1800 frames × ~8MB = 14GB of GPU memory)
- Instead, use a **streaming decode** approach: decode frames on-demand or in small batches
- The export loop requests frames sequentially, so the decoder can stay ahead by a small buffer (e.g., 5 frames)
- Close each frame immediately after `ctx.drawImage()` and `new VideoFrame(canvas)`

**Backpressure:** Monitor `decoder.decodeQueueSize` — pause feeding chunks if the queue grows too large. Similarly for `encoder.encodeQueueSize`.

### Key Implementation Files

| File | Change |
|------|--------|
| `src/lib/ffmpegExport.ts` | Major rewrite: replace MediaRecorder with VideoEncoder + muxer, replace HTMLVideoElement seeking with VideoDecoder streaming |
| `src/lib/renderer.ts` | Minor: add `VideoFrame` to imageCache type union, update `drawImageCover` dimension detection |
| `src/hooks/useCanvasRenderer.ts` | No change for Option A (keep HTMLVideoElement for preview) |
| `src/hooks/useFFmpegExport.ts` | Update to download `.mp4`, communicate with Web Worker |
| `src/components/ExportModal.tsx` | Update to reflect MP4-only output |
| NEW `src/lib/videoDecoder.ts` | Demux + decode pipeline: takes a Blob, yields VideoFrames on demand |
| NEW `src/lib/exportWorker.ts` | Web Worker: runs decode/encode/compositing pipeline off main thread |
| `package.json` | Add `mp4box`, `mp4-muxer`; remove `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util` |

### Existing Code Notes

- `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util` in package.json are completely unused — safe to remove
- The `ExportFormat` type in `ffmpegExport.ts` already has `'mp4'` but it was never actually supported
- `renderFrame()` already accepts `ImageBitmap` in its union type, so adding `VideoFrame` is consistent
- The `drawImageCover` function uses `img.width` / `img.videoWidth` — needs a `VideoFrame` path using `.displayWidth` / `.displayHeight`

## Related Systems and Tasks

- Completed: [TASKS/07-import-assets.md](../TASKS/07-import-assets.md) — added video import, asset store, current export pipeline
- Spec: [SPECS/07-import-assets.md](../SPECS/07-import-assets.md) — original asset system design
- Current export: `src/lib/ffmpegExport.ts` + `src/hooks/useFFmpegExport.ts` + `src/components/ExportModal.tsx`
- Renderer: `src/lib/renderer.ts` — the compositing core that MUST remain working
- Asset store: `src/lib/assetStore.ts` — provides `getAssetBlob()` for raw video file access

## Resolved Questions

1. **MP4 only for demuxing.** Use MP4Box.js only. Covers ~95% of cases, much simpler. Can expand to multi-format (web-demuxer) later if needed — or add local format conversion as an alternative path.

2. **MP4 only for output.** MP4 (H.264 + AAC) is the only output format for now. More universally compatible. WebM output can be added later.

3. **Yes to Worker-based export.** The project is early/WIP — now is the right time to make this architectural decision before more code depends on the main-thread export path. Run the decode/encode/compositing pipeline in a Web Worker with OffscreenCanvas.

## Acceptance Criteria

- [ ] Video export produces correct output with all annotations (arrows, text, shapes, freehand, photos) composited on top of video clips — identical visual result to current export
- [ ] Video clips in export show correct frames at correct times (frame-accurate)
- [ ] Audio mixing continues to work (audio clips, video audio tracks, volume, playback rate)
- [ ] Export is significantly faster than current approach (target: 3-10x for projects with video clips)
- [ ] MP4 output (H.264 + AAC) is the default and only format
- [ ] Graceful fallback to MediaRecorder on browsers without WebCodecs
- [ ] Export runs in a Web Worker (OffscreenCanvas) — UI stays responsive
- [ ] No GPU memory leaks (all VideoFrames properly closed)
- [ ] Progress reporting still works during export
- [ ] Unused FFmpeg dependencies removed from package.json
- [ ] Live editor preview continues to work (no regression)

## Implementation Notes

### Suggested Phased Approach

**Phase 1: Video Decoder Pipeline**
- Add `mp4box` dependency
- Create `src/lib/videoDecoder.ts` — takes a Blob, provides an async iterator/callback of VideoFrames
- Handle demuxing (MP4Box.js) → decoding (VideoDecoder) with backpressure
- Test: can decode a video and draw frames to canvas

**Phase 2: Video Encoder + Muxer Pipeline**
- Add `mp4-muxer` dependency
- Replace MediaRecorder in `ffmpegExport.ts` with VideoEncoder → mp4-muxer
- Compositing loop: `renderFrame()` → `new VideoFrame(canvas)` → `encoder.encode(frame)` → muxer
- Remove the `setTimeout(1000/fps)` delay — encode as fast as possible
- Test: export produces correct MP4 with annotations

**Phase 3: Integrate Decoded Frames into Export**
- During export, use the new decoder pipeline for video clip frames instead of HTMLVideoElement seeking
- Feed decoded `VideoFrame` into `imageCache` for `renderFrame()` to use
- Streaming approach: decode frames on-demand, close after use
- Test: export with video clips is fast and frame-accurate

**Phase 4: Audio Encoding + Muxing**
- Encode pre-rendered audio buffer with AudioEncoder (or write raw PCM to muxer)
- Mux audio + video tracks together
- Test: export produces correct audio

**Phase 5: Web Worker Export**
- Move the decode/encode/compositing pipeline into a Web Worker
- Use OffscreenCanvas for rendering inside the worker
- Main thread sends project data + asset blobs to worker, receives progress updates + final blob
- Keeps UI fully responsive during export, avoids background tab throttling

**Phase 6: UI + Cleanup**
- Add WebCodecs feature detection + fallback to MediaRecorder
- Remove unused `@ffmpeg/*` dependencies
- Update `drawImageCover` to handle `VideoFrame` dimensions
- Update ExportModal to reflect MP4-only output

### Future Enhancements (Out of Scope)
- WebCodecs-based live preview (replace HTMLVideoElement seeking in editor)
- Multi-format demuxing (web-demuxer for WebM/MKV sources) or local format conversion
- WebM output format option
- Hardware acceleration selection (prefer GPU encoders)
