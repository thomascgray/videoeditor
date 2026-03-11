# Warhammer Battle Report Video Editor — Project Spec

## Overview

A browser-based single-page app that lets you:
1. Import a sequence of photos
2. Annotate each photo with arrows, text, and shapes — each with their own timing
3. Preview the result in real time
4. Export as a proper MP4 video

Stack: **React + Vite**, canvas rendering, **FFmpeg.wasm** for export.

---

## Core Concepts

### The Timeline

The entire project is a single JSON data structure — the **timeline**. Everything is derived from it: the preview, the export, the undo history.

```ts
type Project = {
  id: string
  name: string
  fps: number           // default 30
  width: number         // output resolution, default 1920
  height: number        // default 1080
  slides: Slide[]
}

type Slide = {
  id: string
  photoSrc: string      // base64 or object URL
  duration: number      // seconds this slide is on screen
  annotations: Annotation[]
}

type Annotation = {
  id: string
  type: 'arrow' | 'text' | 'rectangle' | 'circle' | 'freehand'
  appearAt: number      // seconds after slide start, when annotation begins appearing
  animateDuration: number // seconds the draw-on animation takes (0 = instant)
  holdDuration: number  // seconds it stays visible after fully drawn
  style: AnnotationStyle
  data: ArrowData | TextData | ShapeData | FreehandData
}

type AnnotationStyle = {
  color: string         // hex
  lineWidth: number
  opacity: number
  fontSize?: number     // text only
  fontFamily?: string   // text only
  fontWeight?: string   // text only
}

type ArrowData = {
  points: { x: number; y: number }[]  // normalised 0-1 coords
  headSize: number
  curved: boolean
}

type TextData = {
  x: number; y: number  // normalised
  content: string
  background?: string   // optional background box colour
  padding?: number
}

type ShapeData = {
  x: number; y: number
  width: number; height: number  // all normalised
}

type FreehandData = {
  points: { x: number; y: number }[]  // normalised
}
```

All coordinates are **normalised (0–1)** relative to the slide canvas. This means annotations scale correctly to any output resolution.

---

## Architecture

```
src/
  components/
    App.tsx                  # root, holds project state
    Sidebar.tsx              # slide list / import photos
    Canvas.tsx               # preview canvas + annotation overlay
    AnnotationTools.tsx      # toolbar: select arrow/text/shape tool
    SlidePanel.tsx           # per-slide settings (duration)
    AnnotationPanel.tsx      # per-annotation settings (timing, style)
    ExportModal.tsx          # export progress + settings
  hooks/
    useProject.ts            # project state + undo/redo
    useCanvasRenderer.ts     # draws a frame at time T onto a canvas
    usePlayback.ts           # plays preview using requestAnimationFrame
    useFFmpegExport.ts       # drives ffmpeg.wasm frame-by-frame render
  lib/
    renderer.ts              # pure function: renderFrame(ctx, slide, t)
    annotations.ts           # drawing logic for each annotation type
    ffmpegExport.ts          # export pipeline
    projectStorage.ts        # save/load project JSON to localStorage
  types.ts                   # all types above
```

### Key Architectural Rules

- **`renderer.ts` is pure** — `renderFrame(ctx, slide, localTime)` has no side effects and no React dependency. It can be called both from the live preview RAF loop AND from the export loop identically.
- **Normalised coordinates everywhere** — convert to/from pixel coords only at draw time: `pixelX = normX * canvas.width`
- **Project state lives in `useProject`** — all other components receive slices via props or context. No scattered useState.
- **Undo/redo** — `useProject` maintains a stack of project snapshots. Every mutation pushes to the stack. Ctrl+Z / Ctrl+Y work app-wide.

---

## Renderer (`lib/renderer.ts`)

This is the heart of the app. It must be able to render any frame deterministically.

```ts
function renderFrame(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  localTime: number,   // seconds since this slide started
  options: { width: number; height: number }
): void
```

### Render order per frame:
1. Draw photo scaled to fill canvas (object-fit: cover behaviour)
2. For each annotation in z-order:
   a. Calculate `annotationProgress` (0–1) based on `localTime`, `appearAt`, `animateDuration`
   b. If `annotationProgress <= 0`, skip
   c. If past `appearAt + animateDuration + holdDuration`, skip (annotation has disappeared)
   d. Draw annotation at `annotationProgress`

### Animation progress calculation:
```ts
function getAnnotationProgress(annotation: Annotation, localTime: number): number {
  const { appearAt, animateDuration, holdDuration } = annotation
  if (localTime < appearAt) return 0
  if (animateDuration === 0) return 1
  const elapsed = localTime - appearAt
  if (elapsed >= animateDuration) return 1
  return elapsed / animateDuration
}
```

### Arrow drawing (the key animation):
```ts
function drawArrow(ctx, data: ArrowData, style: AnnotationStyle, progress: number, w: number, h: number) {
  const points = data.points.map(p => ({ x: p.x * w, y: p.y * h }))
  // Interpolate along the path up to `progress`
  // For a simple 2-point arrow: draw from points[0] to lerp(points[0], points[1], progress)
  // For multi-point: walk the path segments, stop at the right total distance
  // Draw arrowhead only when progress === 1 (or close to it, > 0.95)
}
```

### Text drawing:
```ts
function drawText(ctx, data: TextData, style: AnnotationStyle, progress: number, w: number, h: number) {
  // progress controls opacity: ctx.globalAlpha = progress
  // Optionally: progress controls a "type-on" effect where only Math.floor(progress * text.length) chars are shown
}
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Project Name]          [Preview ▶] [Export ↓]         │  ← top bar
├──────────┬──────────────────────────────┬────────────────┤
│          │                              │                │
│  Slide   │        Canvas Preview        │  Annotation    │
│  List    │        (16:9)                │  Properties    │
│          │                              │                │
│  + Add   │                              │  (appears when │
│  Photos  │                              │  annotation    │
│          │                              │  selected)     │
├──────────┴──────────────────────────────┴────────────────┤
│  [←] [→]  Slide 3 of 12   Duration: [4.0]s    [tools]   │  ← slide bar
└─────────────────────────────────────────────────────────┘
```

### Annotation Toolbar (bottom of canvas or floating):
- Arrow tool (default)
- Text tool
- Rectangle tool
- Circle tool
- Freehand pen tool
- Select/move tool
- Delete selected

### Canvas interaction modes:
- **Select mode**: click annotation to select, drag to move, handles to resize
- **Arrow mode**: click to set start point, click again (or drag) to set end. Support multi-point arrows by clicking intermediate points, double-click to finish.
- **Text mode**: click to place text input box
- **Shape modes**: drag to draw
- **Freehand**: mousedown+drag, mouseup to finish

---

## Annotation Properties Panel

When an annotation is selected, show:

```
Timing
  Appear at:        [2.5] s  (after slide start)
  Draw duration:    [1.0] s  (0 = instant)
  Hold for:         [3.0] s  (then disappears, 0 = until slide end)

Style
  Colour:           [■ #FF0000]
  Opacity:          [100]%
  Line width:       [4] px

(arrow only)
  Head size:        [20] px
  Curved:           [ ] yes

(text only)
  Font size:        [32] px
  Bold:             [x]
  Background:       [■ #000000]  Opacity: [60]%
```

---

## Slide Panel

When a slide is selected:
- Thumbnail of photo
- Duration (seconds) — number input
- Re-order handle (drag in sidebar)
- Delete slide button
- Duplicate slide button

---

## Playback (`usePlayback.ts`)

```ts
// Global playback time = sum of durations of all previous slides + localTime
// On play: use requestAnimationFrame, increment time by delta
// Seek: click anywhere in a scrubber (optional nice-to-have)
// During playback, canvas re-renders every frame via renderFrame()
```

---

## Export Pipeline (`lib/ffmpegExport.ts`)

Uses `@ffmpeg/ffmpeg` and `@ffmpeg/util` (the newer modular ffmpeg.wasm packages).

### Setup
```ts
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

const ffmpeg = new FFmpeg()
await ffmpeg.load({
  coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
  wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
})
```

Host the ffmpeg-core files locally in `public/ffmpeg/` — do NOT rely on unpkg/CDN for these, it's flaky.

### Export loop
```ts
async function exportVideo(project: Project, onProgress: (pct: number) => void) {
  const { fps, width, height, slides } = project
  const offscreen = new OffscreenCanvas(width, height)
  const ctx = offscreen.getContext('2d')!

  let frameIndex = 0
  const totalFrames = slides.reduce((sum, s) => sum + Math.ceil(s.duration * fps), 0)

  for (const slide of slides) {
    const slideFrames = Math.ceil(slide.duration * fps)
    // Pre-load the photo image once per slide
    const img = await loadImage(slide.photoSrc)

    for (let f = 0; f < slideFrames; f++) {
      const localTime = f / fps
      renderFrame(ctx, slide, localTime, { width, height }, img)

      // Extract pixels and write to ffmpeg virtual FS
      const blob = await offscreen.convertToBlob({ type: 'image/png' })
      const arrayBuffer = await blob.arrayBuffer()
      await ffmpeg.writeFile(`frame${String(frameIndex).padStart(6, '0')}.png`, new Uint8Array(arrayBuffer))

      frameIndex++
      onProgress(frameIndex / totalFrames)
    }
  }

  // Encode
  await ffmpeg.exec([
    '-framerate', String(fps),
    '-i', 'frame%06d.png',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    'output.mp4'
  ])

  const data = await ffmpeg.readFile('output.mp4')
  return new Blob([data], { type: 'video/mp4' })
}
```

### Export modal
- Shows progress bar (frame N of M)
- Resolution selector: 1080p / 720p / 480p
- FPS selector: 30 / 60
- When done: download link auto-triggers

---

## Project Save / Load

- Auto-save to `localStorage` as JSON every time project changes (debounced 1s)
- Photos stored as base64 in the JSON (yes this is big, but fine for now — a typical battle report with 20 photos at ~500KB each = ~10MB, well within localStorage's 10MB limit)
- "New project" button clears state
- "Export project JSON" button for backup
- "Import project JSON" button to restore

---

## Tech Stack

| Thing | Choice | Why |
|---|---|---|
| Framework | React + Vite | You know it, fast dev server |
| Language | TypeScript | Types on the timeline model prevent bugs |
| Styling | Tailwind CSS | Utility classes, dark theme |
| Canvas | Native 2D canvas | No abstraction needed, renderer.ts is simple |
| Video export | `@ffmpeg/ffmpeg` + `@ffmpeg/util` | Proper H.264 MP4 output, runs in browser |
| State | `useReducer` + context | Timeline mutations are action-based, easy to add undo |
| No backend | — | Entirely client-side, no server needed |

---

## Package Installation

```bash
npm create vite@latest battle-report-editor -- --template react-ts
cd battle-report-editor
npm install
npm install @ffmpeg/ffmpeg @ffmpeg/util
npm install tailwindcss @tailwindcss/vite
```

### Vite config for FFmpeg (required — needs cross-origin isolation headers):

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  }
})
```

FFmpeg.wasm requires `SharedArrayBuffer`, which requires these COOP/COEP headers.

### Download ffmpeg-core files

```bash
mkdir -p public/ffmpeg
# Download from the @ffmpeg/core package
node -e "
const fs = require('fs');
const path = require('path');
const corePath = require.resolve('@ffmpeg/core');
// copy ffmpeg-core.js and ffmpeg-core.wasm to public/ffmpeg/
"
```

Or more simply — add a setup script that copies from `node_modules/@ffmpeg/core/dist/umd/` to `public/ffmpeg/`.

---

## Build Order (suggested for Claude Code)

1. **Types** (`src/types.ts`) — define the full data model first
2. **Renderer** (`src/lib/renderer.ts`) — pure function, testable in isolation
3. **`useProject` hook** — project state, mutations, undo/redo
4. **Basic canvas preview** — render current slide at t=0, no animation yet
5. **Photo import** — drag and drop or file picker, creates slides
6. **Playback** — RAF loop, scrubber, play/pause
7. **Arrow tool** — click to draw, renders with animation
8. **Text tool**
9. **Remaining annotation types** (rect, circle, freehand)
10. **Properties panel** — timing and style controls for selected annotation
11. **Slide management** — reorder, duration, duplicate, delete
12. **FFmpeg export** — modal, progress, download
13. **Project save/load** — localStorage + JSON import/export
14. **Polish** — keyboard shortcuts, dark theme, error states

---

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
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+D | Duplicate selected annotation |
| [ / ] | Previous / next slide |
| Escape | Deselect / cancel current tool |

---

## Nice-to-Haves (Post-MVP)

- **Audio track** — import an MP3, it gets muxed in by FFmpeg alongside the video
- **Transition effects** between slides — fade, cut, wipe
- **Slide templates** — e.g. "stat card" template that auto-places a semi-transparent box with model stats
- **Multi-point curved arrows** — bezier control handles
- **Zoom/pan animation** — Ken Burns effect on a slide
- **Annotation groups** — group annotations to move/time them together
- **Snap to grid** — useful for aligning tactical arrows
- **"Draw on" sound effect** — optional swoosh sound plays when arrow animates in

---

## Notes for Claude Code

- Start by scaffolding the file structure and types — get `renderer.ts` working with a hardcoded test slide before wiring up any UI
- The FFmpeg setup is the most likely pain point — get a minimal export working early (just a 3-second video from a single image) before building the full UI on top of it
- Keep `renderer.ts` completely decoupled from React — it should only know about `CanvasRenderingContext2D`, `Slide`, and time
- Use `useReducer` with explicit action types for all project mutations — this makes undo/redo trivial and keeps mutations auditable
- Normalised coordinates (0–1) are non-negotiable — they're what makes export at any resolution work without a separate coordinate system
