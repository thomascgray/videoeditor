# 04 — Improve Drawing Tools

**Status**: In Progress

## Overview

Improve the drawing UX with ghost preview of annotations, live drawing feedback, disconnected freehand strokes, and toolbar reorganization.

## Task Context

- Full spec: [SPECS/04-improve-drawing-tools.md](../SPECS/04-improve-drawing-tools.md)
- Previous task: [TASKS/03-improve-ui.md](../TASKS/03-improve-ui.md) — established canvas interaction, draw/select modes, overlay canvas, transient updates
- `renderFrame()` now accepts `EditorOptions` with `editorMode` and `activeDrawingObjectId`
- Ghost preview uses two-pass rendering: full shape at 0.25 alpha, then animated portion at full opacity
- `FreehandData` uses `strokes: Point[][]` — each inner array is one continuous pen stroke
- `ffmpegExport.ts` calls `renderFrame()` without `editorOptions`, preserving export behavior

## Blockers/Issues

None currently

## TODO

### R1/R3: Ghost preview
- [X] Add `EditorOptions` type and update `renderFrame()` signature in `renderer.ts`
- [X] Implement two-pass ghost rendering in `drawObject()` (ghost at 0.25 alpha, then animated portion at full opacity)
- [X] Skip ghost for photo objects
- [X] Pass `editorMode: true` from `useCanvasRenderer.ts`

### R2: Live drawing feedback
- [X] Pass `activeDrawingObjectId` from Canvas to renderer
- [X] When rendering the active drawing object, use `progress = 1.0` at full opacity (skip ghost)

### R5: Disconnected freehand strokes
- [X] Change `FreehandData` from `{ points }` to `{ strokes }` in `types.ts`
- [X] Rewrite `drawFreehand()` in `annotations.ts` to iterate over strokes array
- [X] Update `Canvas.tsx` freehand drawing: mousedown starts new stroke, mousemove appends to last stroke
- [X] Update `App.tsx` `tightenBbox` to flatten strokes for min/max, renormalize per-stroke
- [X] Update `App.tsx` `handleCreateObject` default freehand data to `{ strokes: [] }`

### R6: Toolbar reorganization
- [X] Remove "Add Photo" button from App.tsx header
- [X] Add `onAddImage` callback to AnnotationTools props
- [X] Add "+ Image" button to AnnotationTools (left of "+ Arrow")

### Export safety
- [X] Verify `ExportModal`/`useFFmpegExport` does NOT pass `editorMode`

### Comment out unused tools
- [X] Comment out rectangle and circle from AnnotationTools toolbar

### AnimateIn sub-bar on timeline
- [X] Add `resize-animate-in` drag state to Timeline
- [X] Render animateIn sub-bar (striped pattern) inside object bars for arrow/freehand types
- [X] Draggable right edge to adjust animateIn duration
- [X] Dragging sub-bar wider than parent expands parent duration

## Work Log

[2026-03-12] Implemented all requirements (R1–R6): ghost preview, live drawing feedback, disconnected freehand strokes, toolbar reorg

- **types.ts**: Changed `FreehandData` from `{ points: Point[] }` to `{ strokes: Point[][] }`
- **annotations.ts**: Rewrote `drawFreehand()` to iterate over strokes array with progressive drawing across all strokes
- **renderer.ts**: Added `EditorOptions` type, `GHOST_ALPHA` constant. `renderFrame()` now accepts optional `editorOptions`. Two-pass ghost rendering for editor mode (skip photos). Active drawing objects render at full progress/opacity.
- **useCanvasRenderer.ts**: Accepts and forwards `EditorOptions` to `renderFrame()`
- **Canvas.tsx**: Derives `activeDrawingObjectId` from drag state, passes `editorMode: true` + active ID to renderer via `useMemo`. Freehand mousedown creates new stroke in `strokes[]`, mousemove appends to last stroke.
- **App.tsx**: `tightenBbox` now handles both arrow `points` and freehand `strokes` (flattens for bbox, renormalizes per-stroke). Default freehand data is `{ strokes: [] }`. Removed "Add Photo" button, passes `onAddImage` to AnnotationTools.
- **AnnotationTools.tsx**: Added `onAddImage` prop, "+ Image" button before creation buttons.
- Files modified: `src/types.ts`, `src/lib/annotations.ts`, `src/lib/renderer.ts`, `src/hooks/useCanvasRenderer.ts`, `src/components/Canvas.tsx`, `src/components/App.tsx`, `src/components/AnnotationTools.tsx`

[2026-03-12] Comment out rectangle/circle from toolbar, add animateIn sub-bar to timeline

- Commented out rectangle and circle creation buttons in `AnnotationTools.tsx`
- Added `resize-animate-in` drag state to `Timeline.tsx` for adjusting `animateIn` duration
- Rendered a striped sub-bar inside timeline object bars (arrow/freehand only) showing animateIn duration
- Sub-bar right edge is draggable; expanding beyond parent duration auto-extends the parent
- Files modified: `src/components/AnnotationTools.tsx`, `src/components/Timeline.tsx`
