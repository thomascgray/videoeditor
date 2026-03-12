# 04 — Improve Drawing Tools

**Status**: In Progress

## Overview

Improve the drawing UX with ghost preview of annotations, live drawing feedback, disconnected freehand strokes, and toolbar reorganization.

## Task Context

- Full spec: [SPECS/04-improve-drawing-tools.md](../SPECS/04-improve-drawing-tools.md)
- Previous task: [TASKS/03-improve-ui.md](../TASKS/03-improve-ui.md) — established canvas interaction, draw/select modes, overlay canvas, transient updates
- `renderFrame()` in `renderer.ts` currently has no concept of editor vs export mode — needs `EditorOptions` parameter
- `drawFreehand()` in `annotations.ts` uses `data.points` (flat array) — must change to `data.strokes` (array of arrays)
- `useCanvasRenderer.ts` calls `renderFrame()` — needs to pass `editorMode` and `activeDrawingObjectId`
- `Canvas.tsx` freehand drawing currently appends to `data.points` — must use `data.strokes` with new stroke on mousedown
- `App.tsx` `tightenBbox` flattens `points` — must flatten `strokes` instead
- `ExportModal` calls `renderFrame()` via `useFFmpegExport` — must NOT pass `editorMode` to preserve current animate-in behavior

## Blockers/Issues

None currently

## TODO

### R1/R3: Ghost preview
- [ ] Add `EditorOptions` type and update `renderFrame()` signature in `renderer.ts`
- [ ] Implement two-pass ghost rendering in `drawObject()` (ghost at 0.25 alpha, then animated portion at full opacity)
- [ ] Skip ghost for photo objects
- [ ] Pass `editorMode: true` from `useCanvasRenderer.ts`

### R2: Live drawing feedback
- [ ] Pass `activeDrawingObjectId` from Canvas to renderer
- [ ] When rendering the active drawing object, use `progress = 1.0` at full opacity (skip ghost)

### R5: Disconnected freehand strokes
- [ ] Change `FreehandData` from `{ points }` to `{ strokes }` in `types.ts`
- [ ] Rewrite `drawFreehand()` in `annotations.ts` to iterate over strokes array
- [ ] Update `Canvas.tsx` freehand drawing: mousedown starts new stroke, mousemove appends to last stroke
- [ ] Update `App.tsx` `tightenBbox` to flatten strokes for min/max, renormalize per-stroke
- [ ] Update `App.tsx` `handleCreateObject` default freehand data to `{ strokes: [] }`

### R6: Toolbar reorganization
- [ ] Remove "Add Photo" button from App.tsx header
- [ ] Add `onAddImage` callback to AnnotationTools props
- [ ] Add "+ Image" button to AnnotationTools (left of "+ Arrow")

### Export safety
- [ ] Verify `ExportModal`/`useFFmpegExport` does NOT pass `editorMode`

## Work Log
