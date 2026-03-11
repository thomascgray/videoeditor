# 01 - Initial Project Scaffold & Export

**Status**: In Progress

## Overview

Set up the Warhammer Battle Report Editor from scratch — a browser-based SPA for creating battle report videos from photos. Scaffold the entire React project, build out the core architecture (types, renderer, state management, components), and get video export working.

## Task Context

- Full spec lives in `warhammer-battle-report-editor-spec.md` at project root
- Stack: React + Vite + TypeScript + Tailwind CSS v4
- **Export uses native `MediaRecorder` + `canvas.captureStream(0)`** — NOT ffmpeg.wasm. Hardware-accelerated VP9 encoding, near-instant even at 1080p. FFmpeg.wasm was too slow (~10x realtime for VP8 encoding in WASM).
- COOP/COEP headers still in `vite.config.ts` (were needed for ffmpeg, kept for now)
- `@ffmpeg/ffmpeg`, `@ffmpeg/core`, `@ffmpeg/util` still in dependencies but no longer used at runtime — can be removed in a cleanup pass
- Renderer (`src/lib/renderer.ts`) is pure — no React dependency. Same function used for preview and export.
- All annotation coordinates are normalised 0–1. Pixel conversion at draw time only.
- Project state uses `useReducer` with undo/redo stack (max 50 snapshots), auto-saves to localStorage debounced 1s
- The `useCanvasRenderer` hook needed a state counter (`imageLoaded`) to trigger re-render after async image load — without this, the canvas stays blank after adding a photo

## Blockers/Issues

- **FFmpeg.wasm abandoned** — loading issues (UMD vs ESM), and VP8 encoding in WASM was ~10x slower than realtime. Replaced entirely with native `MediaRecorder` + `captureStream`. Outputs WebM (VP9). Near-instant.
- MP4 export not available — `MediaRecorder` only outputs WebM. Could add ffmpeg.wasm back for WebM-to-MP4 remuxing if needed later, but WebM is widely supported.

## TODO

[X] Initialize Vite + React + TypeScript project
[X] Install dependencies (Tailwind CSS v4, @ffmpeg/ffmpeg, @ffmpeg/util, @ffmpeg/core)
[X] Configure Vite (COOP/COEP headers, Tailwind plugin, optimizeDeps exclude)
[X] Create type definitions (`src/types.ts`) — Project, Slide, Annotation, action types, factory functions
[X] Create core lib files
  [X] `src/lib/renderer.ts` — pure renderFrame function, image cover drawing
  [X] `src/lib/annotations.ts` — drawing logic for arrow, text, rectangle, circle, freehand
  [X] `src/lib/projectStorage.ts` — localStorage save/load, JSON import/export
  [X] `src/lib/ffmpegExport.ts` — FFmpeg.wasm export pipeline
[X] Create hooks
  [X] `src/hooks/useProject.ts` — useReducer with undo/redo stack
  [X] `src/hooks/useCanvasRenderer.ts` — renders slide frames to canvas
  [X] `src/hooks/usePlayback.ts` — requestAnimationFrame playback loop
  [X] `src/hooks/useFFmpegExport.ts` — export state management
[X] Create components
  [X] `src/components/App.tsx` — root layout, keyboard shortcuts
  [X] `src/components/Sidebar.tsx` — slide list + add photos button
  [X] `src/components/Canvas.tsx` — preview canvas
  [X] `src/components/AnnotationTools.tsx` — tool selector bar
  [X] `src/components/SlidePanel.tsx` — slide duration/duplicate/delete
  [X] `src/components/AnnotationPanel.tsx` — annotation timing/style controls
  [X] `src/components/ExportModal.tsx` — export dialog with format toggle + progress
  [X] `src/components/ImportModal.tsx` — drag & drop, file picker, clipboard paste
[X] Set up entry point, Tailwind CSS, index.html
[X] Fix canvas not showing photos (async image load not triggering re-render)
[X] Fix FFmpeg loading (use ESM build instead of UMD)
[X] Add WebM export option as default format
[X] Replace ffmpeg.wasm with native MediaRecorder + captureStream (hardware-accelerated)
[X] Verify export produces a downloadable video
[ ] Canvas interaction — drawing annotations on click/drag (not yet implemented)
[ ] Playback preview testing with multiple slides
[ ] Clean up unused ffmpeg dependencies and public/ffmpeg/ files

## Work Log

[2026-03-11] Scaffolded entire project from empty directory

- Created Vite + React + TypeScript project
- Installed: tailwindcss, @tailwindcss/vite, @ffmpeg/ffmpeg, @ffmpeg/util, @ffmpeg/core
- Configured vite.config.ts with COOP/COEP headers, Tailwind plugin, optimizeDeps exclude
- Created all source files: types.ts, 4 lib files, 4 hooks, 7 components
- Set up Tailwind CSS v4 with dark theme, updated index.html title
- Removed Vite boilerplate (App.tsx, App.css, assets)
- Build passes cleanly with zero type errors
- Files modified: all files in src/, vite.config.ts, index.html, package.json

[2026-03-11] Added ImportModal with drag & drop, file picker, and clipboard paste

- Replaced inline file picker in Sidebar with a proper modal
- Modal supports: drag & drop, click-to-browse, Ctrl+V paste from clipboard
- Shows thumbnail previews in grid before importing, with individual remove buttons
- Files modified: src/components/ImportModal.tsx (new), src/components/Sidebar.tsx

[2026-03-11] Fixed canvas not showing imported photos

- Root cause: useCanvasRenderer loaded images async but nothing triggered re-render when load completed
- Fix: added `imageLoaded` state counter that increments on load, added to render effect deps
- Files modified: src/hooks/useCanvasRenderer.ts

[2026-03-11] Fixed FFmpeg export crash and added WebM support

- Installed missing @ffmpeg/core package
- Identified root cause of "failed to import ffmpeg-core.js": @ffmpeg/ffmpeg 0.12 uses module Worker which needs ESM build, but we had copied UMD build
- Copied ESM build from node_modules/@ffmpeg/core/dist/esm/ to public/ffmpeg/
- Added format toggle (WebM/MP4) to ExportModal, WebM as default
- Added detailed error messages to export pipeline (FFmpeg load, frame render, encoding phases)
- Files modified: src/lib/ffmpegExport.ts, src/hooks/useFFmpegExport.ts, src/components/ExportModal.tsx, public/ffmpeg/

[2026-03-11] Replaced ffmpeg.wasm export with native MediaRecorder

- ffmpeg.wasm VP8 encoding was ~10x slower than realtime (30s+ for a 5s 1080p clip)
- Tried raw pixel input (-f rawvideo) to skip PNG encode/decode — still too slow
- Replaced entirely with `canvas.captureStream(0)` + `MediaRecorder` using browser's native hardware-accelerated VP9 encoder
- Export is now near-instant for short clips
- Removed format toggle (MediaRecorder only outputs WebM), simplified ExportModal
- Files modified: src/lib/ffmpegExport.ts, src/hooks/useFFmpegExport.ts, src/components/ExportModal.tsx
