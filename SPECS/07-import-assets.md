# 07 - Import Assets (Images, Audio, Video)

## Overview

Replace the existing "+ Image" button with a "+ Asset" button that opens a unified import modal supporting three asset types: **images**, **audio clips**, and **video clips**. Audio and video clips appear as object bars on the timeline with adjustable volume. Both audio and video play back during preview and are included in export. Resizing a clip on the timeline changes its playback rate (speeds up/slows down) rather than trimming.

## Requirements

### 1. Unified Asset Import Modal

- Replace "+ Image" button (currently in AnnotationTools) with "+ Asset"
- Modal clearly presents three import categories: Image, Audio, Video
- Each category accepts relevant file types:
  - **Image:** `image/*` (PNG, JPG, WebP, GIF, etc.)
  - **Audio:** `audio/*` (MP3, WAV, OGG, AAC, FLAC, etc.)
  - **Video:** `video/*` (MP4, WebM, MOV, etc.)
- Support drag & drop, file picker, and clipboard paste (images only for paste)
- User can import multiple files at once (mixed types OK)
- Preview section shows:
  - Images: thumbnail (existing behavior)
  - Audio: filename + duration + audio icon
  - Video: filename + duration + thumbnail frame
- Remove button per item before confirming import

### 2. Audio Clips on Timeline

- Audio clips appear as object bars on the timeline (like photos/arrows/etc.)
- Distinct color coding (e.g., teal/cyan)
- **Waveform visualization** rendered as subtle background inside the bar
- Bar displays clip name and time range
- User can move, resize, and adjust lane
- **Resizing changes playback rate** — if a 10s clip is resized to 5s, it plays at 2x speed
- Properties panel shows:
  - Name
  - Start time, duration (which derives playback rate from original duration)
  - Lane
  - **Volume** (0–100% slider)
  - Playback rate (read-only, derived from duration vs original duration)

### 3. Video Clips on Timeline

- Video clips appear as object bars on the timeline
- Distinct color coding (e.g., indigo/violet)
- Bar displays clip name and time range
- User can move, resize, and adjust lane
- **Resizing changes playback rate** — same behavior as audio
- Video renders its current frame on the canvas at the object's position/size
- Properties panel shows:
  - Name, start time, duration, lane
  - Position (x, y), size (width, height), rotation
  - Opacity
  - **Volume** (0–100% slider, since videos can have audio tracks)
  - Playback rate (read-only, derived)

### 4. Playback with Audio

- During preview playback, audio clips play at their configured volume and playback rate
- Audio playback syncs with the global timeline (seeking, play/pause)
- Video clips also play their audio track (if present) at configured volume and rate
- **Mute button** near the play button (mutes all audio/video globally)

### 5. Export

Two distinct export concepts:

#### Video Export (existing, enhanced)
- Exported video includes mixed audio from all audio/video clips
- Audio clips mixed at configured volumes and playback rates
- Video clip audio tracks mixed similarly
- Output: `.webm` file (existing MediaRecorder-based pipeline)

#### Project Export (new)
- Exports a `.brep` file (or similar extension) which is actually a ZIP archive containing:
  - `project.json` — the project data with asset references
  - `assets/` folder — all asset blobs (images, audio, video)
- Project import reads `.brep`, extracts assets into IndexedDB, and loads project
- This replaces the current JSON-only export for projects that contain media assets

## Technical Considerations

### Asset Storage Strategy

**Problem:** Images are currently stored as base64 data URLs in `PhotoData.src`. This works for images (typically 100KB–5MB) but audio and video files can be 10MB–500MB+. Storing them as base64 in the project JSON would bloat it enormously and exceed localStorage's 5MB quota.

**Solution: Asset Store with IndexedDB**

1. **Runtime:** `AssetStore` class holding a `Map<string, Blob>` in memory
2. **Playback/rendering:** `URL.createObjectURL(blob)` for `<audio>`, `<video>`, and `<img>` elements
3. **Persistence:** **IndexedDB** stores asset blobs keyed by asset ID (survives page reloads)
4. **Project JSON:** References assets by ID only — metadata in `Project.assets[]`, blob data in IndexedDB
5. **Project export:** ZIP archive (`.brep`) bundles project.json + asset files
6. **Images:** `PhotoData.src` (base64) is replaced entirely with `PhotoData.assetId` — no legacy support needed

**Memory Budget:** IndexedDB can store GBs. Runtime memory is the real constraint — browsers typically allow 1–4GB per tab. A practical guideline:
- Warn at **50MB per individual file**
- Warn at **500MB total project assets**
- This comfortably allows ~15–20 thirty-second video clips

### Waveform Generation

Waveform data for audio timeline bars can be computed on import:
1. Decode audio file using `AudioContext.decodeAudioData()`
2. Get channel data from `AudioBuffer.getChannelData(0)`
3. Downsample to ~200 peak values (enough for visual resolution)
4. Store peaks array in `AudioData.waveform: number[]`
5. Render as filled bars inside the timeline object bar, scaled to bar height
6. When playback rate changes (resize), the waveform just stretches/compresses with CSS or canvas scaling

This is lightweight — `decodeAudioData` is fast and the resulting peaks array is tiny.

### TypeScript Types (Current)

```typescript
// src/types.ts - Current state
type TimelineObjectType = 'photo' | 'arrow' | 'text' | 'rectangle' | 'circle' | 'freehand'

interface PhotoData { src: string }  // base64 data URL
interface ArrowData { points: {x:number, y:number}[], headSize: number, curvature: number, progressiveHead: boolean }
interface TextData { content: string, background?: string, padding?: number }
interface ShapeData {}
interface FreehandData { strokes: {x:number, y:number}[][] }

interface TimelineObject {
  id: string
  type: TimelineObjectType
  name: string
  startTime: number
  duration: number
  lane: number
  x: number, y: number, width: number, height: number
  rotation: number
  animateIn: number
  style: ObjectStyle
  data: PhotoData | ArrowData | TextData | ShapeData | FreehandData
}

interface Project {
  id: string
  name: string
  fps: number
  width: number
  height: number
  objects: TimelineObject[]
}
```

### TypeScript Types (Proposed New/Modified)

```typescript
// Extended object types
type TimelineObjectType = 'photo' | 'arrow' | 'text' | 'rectangle' | 'circle' | 'freehand' | 'audio' | 'video'

// New data types
interface AudioData {
  assetId: string           // reference to asset in asset store
  volume: number            // 0–1
  originalDuration: number  // seconds — the source file's actual duration
  waveform?: number[]       // ~200 peak values for visualization
}

interface VideoData {
  assetId: string           // reference to asset in asset store
  volume: number            // 0–1
  originalDuration: number  // seconds — the source file's actual duration
}

// Derived at runtime: playbackRate = originalDuration / object.duration

// Asset registry types
type AssetType = 'image' | 'audio' | 'video'

interface AssetMeta {
  id: string             // UUID
  type: AssetType
  filename: string
  mimeType: string
  size: number           // bytes
  duration?: number      // seconds, for audio/video
}

// Project gets an asset manifest
interface Project {
  id: string
  name: string
  fps: number
  width: number
  height: number
  objects: TimelineObject[]
  assets?: AssetMeta[]   // metadata only, blobs stored separately
}

// Photos now use the asset store like everything else
interface PhotoData {
  assetId: string        // reference to asset in asset store
}
```

### Key Implementation Files

| File | Changes |
|------|---------|
| `src/types.ts` | Add `'audio'`, `'video'` to TimelineObjectType; add AudioData, VideoData, AssetMeta types |
| `src/components/AnnotationTools.tsx` | Rename "+ Image" to "+ Asset" |
| `src/components/ImportModal.tsx` | Major rework: unified UI for 3 asset types, file type detection, duration extraction, waveform generation |
| `src/components/App.tsx` | Handle new object creation for audio/video, integrate audio playback, mute button |
| `src/components/Timeline.tsx` | Add color coding for audio/video, waveform rendering in audio bars |
| `src/components/PropertiesPanel.tsx` | Add volume slider, playback rate display, conditional sections for audio/video |
| `src/lib/renderer.ts` | Handle video frame rendering (draw current video frame to canvas) |
| `src/hooks/usePlayback.ts` | Integrate audio/video playback sync with playbackRate |
| `src/lib/ffmpegExport.ts` | Mix audio tracks into exported video via AudioContext + MediaStreamAudioDestinationNode |
| `src/lib/projectStorage.ts` | Add `.brep` ZIP project export/import alongside existing JSON |
| NEW `src/lib/assetStore.ts` | Asset registry: blob Map, IndexedDB persistence, Object URL management |
| NEW `src/hooks/useAudioPlayback.ts` | Manage HTMLAudioElement/HTMLVideoElement sync with timeline |
| NEW dependency: `jszip` | For `.brep` project export/import |

### Audio/Video Playback Architecture

**Approach: HTMLMediaElement with playbackRate**

For each audio/video clip, create a hidden `HTMLAudioElement` or `HTMLVideoElement`:
- Set `playbackRate = originalDuration / object.duration`
- Set `volume` from AudioData/VideoData
- On play: `element.currentTime = offset; element.play()`
- On pause: `element.pause()`
- On seek: `element.currentTime = seekOffset`
- Global mute: set `element.muted = true` on all elements

HTMLMediaElement natively supports `playbackRate` (typically 0.25x–4x range in browsers), which makes the speed-up/slow-down behavior straightforward.

**Video frame rendering** during playback:
- HTMLVideoElement plays normally (the browser decodes frames)
- On each animation frame, `ctx.drawImage(videoElement, ...)` grabs the current frame
- This naturally syncs because the video is actually playing

**Video frame rendering** during export:
- More complex — need to seek frame-by-frame
- Use `video.currentTime = frameTime; await video.seeked` for each frame
- Slower than real-time but accurate

### Export Audio Mixing

Current export uses `MediaRecorder` with `canvas.captureStream(0)`.

To add audio:
1. Create `AudioContext`
2. For each audio/video clip active at export time, create `MediaElementAudioSourceNode`
3. Route through `GainNode` (per-clip volume) → `GainNode` (master) → `MediaStreamAudioDestinationNode`
4. Combine canvas video track + audio destination stream into one `MediaStream`
5. Feed combined stream to `MediaRecorder`
6. During frame-by-frame export, audio elements play at appropriate times/rates

### Existing Code Notes

- **FFmpeg deps in package.json are unused** — export is purely MediaRecorder-based. Could clean these up.
- **JSON project export/import already exists** in `projectStorage.ts` — the new `.brep` format extends this, not replaces it (JSON still useful for projects with no media assets).

## Related Systems and Tasks

- Current image import: `src/components/ImportModal.tsx`
- Current export: `src/lib/ffmpegExport.ts` + `src/hooks/useFFmpegExport.ts`
- Playback: `src/hooks/usePlayback.ts`
- Project persistence: `src/lib/projectStorage.ts` (localStorage + JSON export/import)

## Open Questions

All resolved. See decisions below:

1. **Image migration: RESOLVED** — All imports (including images) use the asset store. `PhotoData.src` (base64) is removed entirely and replaced with `PhotoData.assetId`. No legacy/backward compat needed — project is brand new, no existing data to migrate.

2. **Playback rate limits: RESOLVED** — Clamp resize to keep `playbackRate` within browser-supported 0.25x–4x range. For a 10s clip: min duration = 2.5s (4x speed), max duration = 40s (0.25x speed).

3. **`.brep` file extension: RESOLVED** — `.brep` is fine. Can always change later.

## Acceptance Criteria

- [ ] "+ Image" button replaced with "+ Asset" button
- [ ] Import modal allows importing images, audio clips, and video clips with clear UI distinction
- [ ] Imported audio clips appear as colored bars on the timeline with waveform background
- [ ] Imported video clips appear as colored bars on the timeline AND render their current frame on the canvas
- [ ] Resizing audio/video clips changes playback rate (not trim)
- [ ] Audio clips have volume adjustable in properties panel
- [ ] Video clips have volume + position/size/opacity adjustable in properties panel
- [ ] During playback, audio plays in sync with the timeline at correct rate and volume
- [ ] During playback, video frames update in sync with the timeline
- [ ] Seeking updates audio/video position correctly
- [ ] Play/pause controls audio/video correctly
- [ ] Mute button near the play button mutes all audio
- [ ] Assets persist across page reloads (IndexedDB)
- [ ] Video export includes mixed audio
- [ ] Project export produces `.brep` ZIP containing JSON + assets
- [ ] Project import reads `.brep` and restores full project with assets
- [ ] Image import works through the asset store (base64 removed)
- [ ] File size warnings for large assets (>50MB per file, >500MB total)

## Implementation Notes

### Suggested Phased Approach

**Phase 1: Asset Store + Unified Import Modal**
- Add `jszip` dependency
- Build `assetStore.ts` with IndexedDB backing
- Rework ImportModal to accept all three types with file type detection
- Rename button to "+ Asset"
- All imports (including images) go through the asset store
- `PhotoData.src` replaced with `PhotoData.assetId`

**Phase 2: Audio Clips**
- Add `'audio'` type and `AudioData` to types
- Timeline bar rendering with waveform background
- Properties panel: volume slider, playback rate display
- `useAudioPlayback` hook: HTMLAudioElement sync with timeline + playbackRate
- Mute button near play controls

**Phase 3: Video Clips**
- Add `'video'` type and `VideoData` to types
- Timeline bar rendering
- Canvas rendering: `ctx.drawImage(videoElement, ...)` for current frame
- Properties panel: volume + position/size + playback rate
- Video playback sync with playbackRate

**Phase 4: Export**
- Audio mixing in video export via AudioContext + MediaStreamAudioDestinationNode
- `.brep` project export/import (ZIP with jszip)

### Future Enhancements (Out of Scope)
- Audio pitch manipulation
- Trim/truncate (start offset into source clip)
- Audio waveform improvements (stereo, zoom)
- Video filters/effects
- Audio fade in/out
- Playback rate as a manually editable property

---

*This specification is ready for implementation. Use `/task 07-import-assets` to begin development.*
