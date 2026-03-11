# Warhammer Battle Report Editor

A browser-based video editor for creating Warhammer battle report videos from photos. Import your battle photos, annotate them with arrows, text, and shapes (each with their own draw-on animations and timing), preview the result in real time, and export as MP4.

Entirely client-side — no server required.

## Tech Stack

- **React + Vite** — TypeScript, fast HMR
- **Tailwind CSS v4** — utility-first dark theme
- **Canvas 2D** — native canvas rendering, no abstraction layer
- **FFmpeg.wasm** — in-browser H.264 MP4 export via `@ffmpeg/ffmpeg` + `@ffmpeg/util`
- **`useReducer` + context** — action-based state with built-in undo/redo

## Getting Started

```bash
npm install
npm run dev
```

The dev server runs with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers enabled (required for FFmpeg.wasm's SharedArrayBuffer support).

## Project Structure

```
src/
  types.ts                        # Data model: Project, Slide, Annotation, etc.
  components/
    App.tsx                       # Root layout, keyboard shortcuts, state wiring
    Sidebar.tsx                   # Slide list thumbnails + photo import
    Canvas.tsx                    # Preview canvas with renderer hook
    AnnotationTools.tsx           # Tool selector (select, arrow, text, rect, circle, pen)
    SlidePanel.tsx                # Per-slide settings (duration, duplicate, delete)
    AnnotationPanel.tsx           # Per-annotation settings (timing, style, color)
    ExportModal.tsx               # Export dialog with progress bar
  hooks/
    useProject.ts                 # Project state + undo/redo (50-step history)
    useCanvasRenderer.ts          # Draws a frame at time T onto a canvas element
    usePlayback.ts                # requestAnimationFrame playback loop
    useFFmpegExport.ts            # FFmpeg export with progress callback
  lib/
    renderer.ts                   # Pure renderFrame(ctx, slide, localTime) — no React
    annotations.ts                # Drawing logic for each annotation type
    ffmpegExport.ts               # FFmpeg.wasm export pipeline (frame-by-frame)
    projectStorage.ts             # localStorage save/load + JSON import/export
```

## Architecture

### Renderer is pure

`renderer.ts` exposes `renderFrame(ctx, slide, localTime, options, img)` with no side effects and no React dependency. The same function is called from both the live preview RAF loop and the FFmpeg export loop, guaranteeing frame-identical output.

### Normalised coordinates

All annotation coordinates are normalised to 0–1 relative to the canvas. Pixel conversion happens only at draw time (`pixelX = normX * canvas.width`), so annotations scale correctly to any export resolution.

### State management

All project state lives in `useProject`, backed by `useReducer` with explicit action types. Every mutation pushes to an undo stack (max 50 snapshots). No scattered `useState` — components receive slices via props.

### Auto-save

Project state auto-saves to `localStorage` on every change (debounced 1s). Photos are stored as base64 in the JSON.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Play / Pause |
| A | Arrow tool |
| T | Text tool |
| R | Rectangle tool |
| V | Select tool |
| Delete / Backspace | Delete selected annotation |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| [ / ] | Previous / next slide |
| Escape | Deselect / cancel tool |

## FFmpeg Export

Export requires ffmpeg-core files in `public/ffmpeg/`. Copy them from `node_modules/@ffmpeg/core/dist/umd/`:

```bash
mkdir -p public/ffmpeg
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js public/ffmpeg/
cp node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm public/ffmpeg/
```

The export pipeline renders every frame to an OffscreenCanvas, writes PNGs to FFmpeg's virtual filesystem, then encodes to H.264 MP4.

## Build

```bash
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build locally
```
