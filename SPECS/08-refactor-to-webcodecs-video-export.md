# 08 - Refactor to WebCodecs Video Export

## Overview

Replace the current HTMLVideoElement-seeking + MediaRecorder export pipeline with WebCodecs API (`VideoDecoder` / `VideoEncoder`) for dramatically faster, frame-accurate video export. Also improve the live preview scrubbing for video clips using sequential decoding.

The existing compositing system (`renderFrame` in `renderer.ts`) which handles all annotation types (arrows, text, shapes, freehand, photos) composited via Canvas2D must continue working unchanged — this refactor only replaces how video frames are sourced and how the final output is encoded.

## Requirements

### 1. Replace Video Frame Sourcing (Decode Side)

**Current approach:** `HTMLVideoElement` + `video.currentTime = X` + `await seeked` event + `ctx.drawImage(video)`. Slow because each seek may decode up to 30 frames internally (GOP size).

**New approach:**
- Demux source video files using a demuxer library (MP4Box.js or web-demuxer)
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
- Mux with **mp4-muxer** or **webm-muxer** to produce final file
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

### 5. Output Format Options

With WebCodecs + a muxer, we can support:
- **MP4 (H.264 + AAC)** — universally compatible, better for sharing
- **WebM (VP9 + Opus)** — current format, open source

The user should be able to choose format in the Export Modal.

### 6. Graceful Fallback

If WebCodecs is not available (older browsers, ~5% of users), fall back to the current MediaRecorder approach. Feature-detect with:
```typescript
const hasWebCodecs = typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined'
```

## Technical Considerations

### Demuxer Selection

Two main options for extracting `EncodedVideoChunk` from container formats:

**Option A: MP4Box.js** (recommended to start)
- Mature, widely used, JS-native (no WASM)
- Generates `VideoDecoderConfig` and `EncodedVideoChunk` compatible with WebCodecs
- Used in official W3C WebCodecs samples
- Only supports MP4 containers
- ~50KB gzipped

**Option B: web-demuxer** (by Bilibili)
- WASM-based, supports MP4, MKV, WebM, AVI, FLV, MPEG-TS
- Designed for WebCodecs — provides `getDecoderConfig()`, `seek()`, `read()`
- 493KB gzipped (mini build for MP4/MKV/WebM)
- Better multi-format support, heavier bundle

**Recommendation:** Start with MP4Box.js for MP4 support. Users likely import MP4 clips. Can add web-demuxer later for broader format support.

### Muxer Selection

**mp4-muxer** (for MP4 output) — npm package, produces MP4 with H.264 video + AAC audio
**webm-muxer** (for WebM output) — npm package, produces WebM with VP8/VP9 video + Opus audio

Both accept `EncodedVideoChunk` / `EncodedAudioChunk` from WebCodecs directly.

### New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `mp4box` | Demux MP4 source videos | ~50KB gz |
| `mp4-muxer` | Mux MP4 output | ~15KB gz |
| `webm-muxer` | Mux WebM output | ~12KB gz |

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
  [EncodedVideoChunks + EncodedAudioChunks] → [mp4-muxer / webm-muxer] → [Blob]
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
| `src/hooks/useFFmpegExport.ts` | Update to support format selection, download `.mp4` or `.webm` |
| `src/components/ExportModal.tsx` | Add format selector (MP4 / WebM) |
| NEW `src/lib/videoDecoder.ts` | Demux + decode pipeline: takes a Blob, yields VideoFrames on demand |
| `package.json` | Add `mp4box`, `mp4-muxer`, `webm-muxer`; remove `@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util` |

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

## Open Questions

1. **MP4 only or multi-format demuxing?** Should we only support MP4 source clips (MP4Box.js) or also WebM/MKV/etc (web-demuxer)? MP4 is simpler and covers 95% of cases. Users importing WebM clips would need the heavier demuxer.

2. **Output format default:** Should MP4 be the new default output format (more universally compatible) or keep WebM as default?

3. **Worker-based export?** Moving the decode/encode pipeline to a Web Worker with OffscreenCanvas would keep the UI fully responsive during export and avoid background tab throttling. Worth the added complexity?

## Acceptance Criteria

- [ ] Video export produces correct output with all annotations (arrows, text, shapes, freehand, photos) composited on top of video clips — identical visual result to current export
- [ ] Video clips in export show correct frames at correct times (frame-accurate)
- [ ] Audio mixing continues to work (audio clips, video audio tracks, volume, playback rate)
- [ ] Export is significantly faster than current approach (target: 3-10x for projects with video clips)
- [ ] MP4 output option available (H.264 + AAC)
- [ ] WebM output option still available
- [ ] Format selector in Export Modal
- [ ] Graceful fallback to MediaRecorder on browsers without WebCodecs
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
- Add `mp4-muxer` and `webm-muxer` dependencies
- Replace MediaRecorder in `ffmpegExport.ts` with VideoEncoder → muxer
- Compositing loop: `renderFrame()` → `new VideoFrame(canvas)` → `encoder.encode(frame)` → muxer
- Remove the `setTimeout(1000/fps)` delay — encode as fast as possible
- Test: export produces correct MP4/WebM with annotations

**Phase 3: Integrate Decoded Frames into Export**
- During export, use the new decoder pipeline for video clip frames instead of HTMLVideoElement seeking
- Feed decoded `VideoFrame` into `imageCache` for `renderFrame()` to use
- Streaming approach: decode frames on-demand, close after use
- Test: export with video clips is fast and frame-accurate

**Phase 4: Audio Encoding + Muxing**
- Encode pre-rendered audio buffer with AudioEncoder (or write raw PCM to muxer)
- Mux audio + video tracks together
- Test: export produces correct audio

**Phase 5: UI + Cleanup**
- Add format selector to ExportModal (MP4 / WebM)
- Add WebCodecs feature detection + fallback
- Remove unused `@ffmpeg/*` dependencies
- Update `drawImageCover` to handle `VideoFrame` dimensions
- Update ExportModal to show format info

### Future Enhancements (Out of Scope)
- WebCodecs-based live preview (replace HTMLVideoElement seeking in editor)
- Web Worker export pipeline (OffscreenCanvas + decoder/encoder in worker)
- Multi-format demuxing (web-demuxer for WebM/MKV sources)
- Hardware acceleration selection (prefer GPU encoders)

---

*This specification has open questions that should be resolved before implementation. See the Open Questions section above.*
