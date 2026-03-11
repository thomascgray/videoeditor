# 02-basic-ui — Timeline-Based Video Editor UI

**Status**: In Progress

## Overview

Rearchitect from slide-based model to timeline-based model per [SPECS/02-basic-ui.md](../SPECS/02-basic-ui.md). All objects (photos, arrows, text, shapes) become `TimelineObject` entries on a multi-lane timeline. No slides, no sidebar.

## Task Context

- Spec document: `SPECS/02-basic-ui.md`
- Original project spec: `warhammer-battle-report-editor-spec.md` (slide-based, being superseded)
- Key files to rewrite: `types.ts`, `renderer.ts`, `useProject.ts`, `usePlayback.ts`, `App.tsx`, `Canvas.tsx`
- Key files to delete: `Sidebar.tsx`, `SlidePanel.tsx`
- Key files to adapt: `ImportModal.tsx`, `ExportModal.tsx`, `ffmpegExport.ts`, `annotations.ts`
- New files: `Timeline.tsx`, `PropertiesPanel.tsx`
- `annotations.ts` draw functions (`drawArrow`, `drawText`, etc.) are reusable as-is — they just take data+style+progress
- Export pipeline (MediaRecorder/VP9) works and just needs updated `renderFrame()` call
- Undo/redo reducer pattern in `useProject.ts` stays, just new action types

## Blockers/Issues

- Export used `setTimeout(r, 0)` between frames, causing MediaRecorder to produce ~1s videos instead of full duration (fixed — now uses `1000/fps` delay for correct wall-clock timestamps)

## TODO

[X] Rewrite `types.ts` — new `TimelineObject`, `Project`, `ProjectAction`, factory functions
[X] Rewrite `renderer.ts` — new `renderFrame()` taking `TimelineObject[]` + globalTime
[X] Rewrite `useProject.ts` — new reducer actions for timeline objects
[X] Rewrite `usePlayback.ts` — simple global time, no slide mapping
[X] Rewrite `useCanvasRenderer.ts` — render based on `TimelineObject[]` + globalTime
[X] Rewrite `App.tsx` — new layout: viewport + timeline, no sidebar
[X] Rewrite `Canvas.tsx` — render all visible objects at current time
[X] Create `Timeline.tsx` — multi-lane timeline with draggable bars + playhead
[X] Create `PropertiesPanel.tsx` — unified object properties editor
[X] Adapt `ImportModal.tsx` — create photo TimelineObjects instead of slides
[X] Adapt `ffmpegExport.ts` — use new renderFrame with objects + globalTime
[X] Adapt `ExportModal.tsx` — use objects instead of slides for stats
[X] Delete `Sidebar.tsx`, `SlidePanel.tsx`, `AnnotationPanel.tsx`
[X] Update keyboard shortcuts in App.tsx
[X] Add localStorage migration (discard old slide-based projects)
[X] Fix export producing ~1s video — MediaRecorder frame timing

## Work Log

[2026-03-11] Full rearchitecture from slide-based to timeline-based model. All files rewritten or adapted. TypeScript + ESLint clean.

- Files rewritten: `types.ts`, `renderer.ts`, `useProject.ts`, `usePlayback.ts`, `useCanvasRenderer.ts`, `App.tsx`, `Canvas.tsx`, `ffmpegExport.ts`
- Files created: `Timeline.tsx`, `PropertiesPanel.tsx`
- Files adapted: `ImportModal.tsx`, `ExportModal.tsx`, `annotations.ts`, `projectStorage.ts`
- Files deleted: `Sidebar.tsx`, `SlidePanel.tsx`, `AnnotationPanel.tsx`

[2026-03-11] Fix export video duration bug — MediaRecorder was recording wall-clock time, not video time. Changed frame delay from 0ms to `1000/fps` ms so exported video has correct duration.

- Files modified: `ffmpegExport.ts`
