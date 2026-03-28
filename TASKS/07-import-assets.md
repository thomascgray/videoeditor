# 07 - Import Assets (Images, Audio, Video)

**Status**: Complete

## Overview

Replace "+ Image" with "+ Asset" button. Unified import modal for images, audio, and video. Asset store backed by IndexedDB replaces base64 image storage. Audio/video clips on timeline with volume control, playback rate via resize, waveform visualization, mute button, and export support. Project export as `.brep` ZIP.

Full spec: [SPECS/07-import-assets.md](../SPECS/07-import-assets.md)

## Task Context

- `src/types.ts` — all type definitions, `createTimelineObject` factory
- `src/components/ImportModal.tsx` — current image-only import (base64, drag/drop/paste)
- `src/components/AnnotationTools.tsx` — has "+ Image" button with `onAddImage` prop
- `src/components/App.tsx` — main state management, wires up ImportModal
- `src/components/Timeline.tsx` — object bars with color coding per type
- `src/components/PropertiesPanel.tsx` — right sidebar for editing properties
- `src/hooks/useCanvasRenderer.ts` — loads images by base64 `src`, caches in Map, renders frames
- `src/lib/renderer.ts` — `renderFrame()` draws objects, `loadImage()` for photos
- `src/lib/projectStorage.ts` — localStorage persistence + JSON export/import
- `src/hooks/usePlayback.ts` — play/pause/seek with requestAnimationFrame
- `src/lib/ffmpegExport.ts` — actually uses MediaRecorder (not FFmpeg), VP8/VP9 WebM
- Image cache in useCanvasRenderer is keyed by base64 `src` string — needs to change to assetId
- No legacy data to worry about — project is brand new WIP

## Blockers/Issues

None currently

## TODO

### Phase 1: Asset Store + Unified Import Modal
- [X] Add `jszip` dependency
- [X] Add new types to `src/types.ts`: `AudioData`, `VideoData`, `AssetMeta`, `AssetType`; update `TimelineObjectType`; change `PhotoData` to use `assetId`; update `Project` with `assets` array; update data union type; add `ADD_ASSETS` action
- [X] Create `src/lib/assetStore.ts` — IndexedDB-backed asset registry with blob Map, Object URL management, waveform generation, media duration extraction, size warnings
- [X] Update `src/components/ImportModal.tsx` — unified modal accepting image/audio/video, file type detection, duration extraction, waveform generation, size warnings, list-style previews with type badges
- [X] Update `src/components/AnnotationTools.tsx` — rename "+ Image" to "+ Asset", rename `onAddImage` to `onAddAsset`
- [X] Update `src/components/App.tsx` — wire up asset store (loadAssetsFromDB on startup), update import flow to use assetIds, onAssetsAdded callback dispatches ADD_ASSETS
- [X] Update `src/hooks/useCanvasRenderer.ts` — load images from asset store (blob URLs) instead of base64, load video elements for video objects
- [X] Update `src/lib/renderer.ts` — use assetId for photo lookup, add video case (drawImageCover with videoElement), handle audio (no-op), support HTMLVideoElement dimensions
- [X] Update `src/lib/ffmpegExport.ts` — use assetId + getAssetUrl for photo loading during export
- [X] Update `src/lib/projectStorage.ts` — ensure assets array exists on load
- [X] Update `src/components/PropertiesPanel.tsx` — volume slider for audio/video, playback rate display, hide position for audio, hide animate-in for audio/video, opacity for video
- [X] Update `src/components/Timeline.tsx` — add teal/violet colors for audio/video
- [X] Update `src/hooks/useProject.ts` — ADD_ASSETS reducer case

### Phase 2: Audio Clips
- [X] Timeline bar rendering for audio with waveform background
- [X] Properties panel: volume slider, playback rate display (done in Phase 1)
- [X] `useAudioPlayback` hook: HTMLAudioElement/HTMLVideoElement sync with timeline + playbackRate
- [X] Mute button near play controls (Sound/Muted toggle)
- [X] Playback rate clamping (0.25x–4x) enforced on resize-left and resize-right in Timeline

### Phase 3: Video Clips
- [X] Timeline bar rendering for video (violet color, done in Phase 1)
- [X] Canvas rendering: `ctx.drawImage(videoElement, ...)` for current frame (done in Phase 1 renderer update)
- [X] Properties panel: volume + position/size/opacity + playback rate (done in Phase 1)
- [X] Video playback sync with playbackRate (done in Phase 2 — useAudioPlayback handles both audio and video)

### Phase 4: Export
- [X] Audio mixing in video export via OfflineAudioContext (pre-renders full audio mix) + MediaStreamAudioDestinationNode
- [X] `.brep` project export (ZIP with jszip: project.json + assets/)
- [X] `.brep` project import (extracts assets into IndexedDB, loads project)
- [X] Save/Load buttons in header for .brep project files

## Work Log

[2026-03-17] Phase 1 complete: Asset store + unified import modal + type system + renderer updates

- Files created: `src/lib/assetStore.ts`
- Files modified: `src/types.ts`, `src/components/ImportModal.tsx`, `src/components/AnnotationTools.tsx`, `src/components/App.tsx`, `src/hooks/useCanvasRenderer.ts`, `src/lib/renderer.ts`, `src/lib/ffmpegExport.ts`, `src/lib/projectStorage.ts`, `src/components/PropertiesPanel.tsx`, `src/components/Timeline.tsx`, `src/hooks/useProject.ts`
- Added `jszip` dependency
- TypeScript compiles clean, production build succeeds

[2026-03-17] Phase 2 complete: Audio playback, mute button, waveform timeline bars, playback rate clamping

- Files created: `src/hooks/useAudioPlayback.ts`
- Files modified: `src/components/App.tsx`, `src/components/Timeline.tsx`
- useAudioPlayback manages HTMLMediaElements synced to timeline (play/pause/seek/playbackRate/volume)
- Mute button (Sound/Muted toggle) added next to Play button
- Waveform visualization rendered as bars inside audio timeline objects
- Resize clamping enforces 0.25x–4x playback rate limits for audio/video

[2026-03-17] Phase 3 was already covered by Phase 1+2 changes (video rendering, properties, timeline colors, playback sync)

[2026-03-17] Phase 4 complete: Audio mixing in export + .brep project export/import

- Files modified: `src/lib/ffmpegExport.ts`, `src/lib/projectStorage.ts`, `src/components/App.tsx`
- Audio mixing uses OfflineAudioContext to pre-render full mix, then plays through AudioContext during recording
- .brep export creates ZIP with project.json + assets/ folder
- .brep import extracts assets into IndexedDB and loads project
- Save/Load buttons added to header next to project name
- Added opus codec options to MIME type detection for audio support
- TypeScript compiles clean, production build succeeds
