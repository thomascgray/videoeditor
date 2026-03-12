# 03 — Improve UI: Canvas Interaction & Timeline Lane Dragging

**Status**: In Progress

## Overview

Add interactive canvas manipulation (select mode: click/drag/resize/rotate objects; draw mode: add lines/strokes to arrow/freehand objects) and timeline lane dragging (vertical drag to change lanes). This is a major UI upgrade that turns the editor from a numeric-input-only tool into a proper visual editor.

## Task Context

- Full spec: [SPECS/03-improve-ui.md](../SPECS/03-improve-ui.md)
- Previous spec establishing current UI: [SPECS/02-basic-ui.md](../SPECS/02-basic-ui.md)
- **Data model refactor needed**: Arrow/freehand points are currently in canvas-space (0–1 of canvas). Must change to object-local coords (0–1 within the object's bounding box). TextData.x/y and ShapeData.x/y/width/height should be removed — position lives on TimelineObject.
- **New `rotation` field**: TimelineObject needs `rotation: number` (radians, default 0). Affects types, renderer, properties panel, and canvas overlay.
- **Toolbar rework**: Current `AnnotationTool` conflates creation tools with interaction modes. Replace with `InteractionMode = 'select' | 'draw'` plus creation action buttons.
- **Canvas overlay**: Add a second canvas on top for selection handles, hit testing, and mouse interaction (Option B from spec).
- **Undo batching**: Dragging creates many UPDATE_OBJECT dispatches. Need `UPDATE_OBJECT_TRANSIENT` that doesn't push to undo stack, with commit on mouseup.
- **lineWidth/fontSize scaling**: Scale relative to bounding box size at render time using `sqrt(area ratio)`.
- Key files: `src/types.ts`, `src/components/Canvas.tsx`, `src/components/Timeline.tsx`, `src/components/App.tsx`, `src/components/AnnotationTools.tsx`, `src/components/PropertiesPanel.tsx`, `src/lib/renderer.ts`, `src/lib/annotations.ts`, `src/hooks/useProject.ts`

## Blockers/Issues

None currently

## TODO

### Phase 1: Data model & type changes
- [X] Add `rotation: number` to `TimelineObject` and default it to `0` in `createTimelineObject`
- [X] Remove positional fields from `TextData` (x, y) and `ShapeData` (x, y, width, height)
- [X] Update annotation draw functions to use object bounding box instead of canvas w/h
- [X] Update renderer.ts to apply rotation transform and pass bounding box to drawers
- [X] Add lineWidth/fontSize scaling relative to bounding box
- [X] Replace `AnnotationTool` type with `InteractionMode = 'select' | 'draw'`
- [X] Add `UPDATE_OBJECT_TRANSIENT` and undo batching support to useProject.ts

### Phase 2: Canvas interaction (select mode)
- [X] Add overlay canvas to Canvas.tsx
- [X] Implement coordinate conversion helpers (client → normalised, hit testing with rotation)
- [X] Implement click-to-select (hit testing on canvas objects)
- [X] Implement drag-to-move selected objects
- [X] Implement resize handles (8 handles: corners + edge midpoints)
- [X] Implement rotation handle (above top-center)
- [X] Draw selection bounding box, resize handles, rotation handle on overlay
- [X] Cursor feedback (move, resize, rotation cursors)
- [X] Add visible canvas border showing export boundary

### Phase 3: Canvas interaction (draw mode)
- [X] Implement draw mode for arrow objects (click-drag adds line segments)
- [X] Implement draw mode for freehand objects (click-drag adds points)
- [X] Auto-enter draw mode when creating new arrow/freehand
- [X] Bounding box tightening on switch from draw → select mode (compute tight bbox, renormalize points)

### Phase 4: Toolbar rework
- [X] Replace AnnotationTools.tsx with new toolbar: Select/Draw mode buttons + creation action buttons
- [X] Wire creation buttons to create objects + set appropriate mode
- [X] Update App.tsx to use `interactionMode` instead of `activeTool`

### Phase 5: Timeline lane dragging
- [X] Extend DragState 'move' kind with startMouseY and originalLane
- [X] Track vertical mouse movement during timeline drag
- [X] Calculate target lane from cursor Y position and update obj.lane
- [X] Render "new lane" drop zones above top / below bottom lane
- [X] Use transient updates during drag, commit on mouseup

### Phase 6: Properties Panel updates
- [X] Add rotation field (display degrees, store radians)
- [X] Ensure position values update live during canvas drag

## Work Log

[2026-03-12] Phase 1 complete: Data model & type changes, toolbar rework, rotation in PropertiesPanel

- **types.ts**: Added `rotation: number` to `TimelineObject`, removed `x/y` from `TextData`, removed `x/y/width/height` from `ShapeData` (now `Record<string, never>`), replaced `AnnotationTool` with `InteractionMode = 'select' | 'draw'`, added `UPDATE_OBJECT_TRANSIENT` and `COMMIT_TRANSIENT` actions, added `rotation` option to `createTimelineObject`
- **annotations.ts**: All draw functions now receive `(bx, by, bw, bh, scaleFactor)` instead of `(w, h)`. Points converted via `bx + p.x * bw`. `drawRectangle`/`drawCircle` no longer take `ShapeData` param. Text now centered in bounding box.
- **renderer.ts**: Applies rotation transform (`ctx.translate/rotate`) around bounding box center. Computes `scaleFactor = sqrt(area ratio)` for lineWidth/fontSize scaling. Passes bounding box coords to all annotation draw functions.
- **useProject.ts**: Added `transientSnapshot` to state. `UPDATE_OBJECT_TRANSIENT` mutates present without undo entry, saves snapshot on first call. `COMMIT_TRANSIENT` pushes snapshot to past stack.
- **AnnotationTools.tsx**: Now shows Select/Draw mode buttons + creation action buttons (+ Arrow, + Text, + Rect, + Circle, + Pen). Draw button disabled when no arrow/freehand selected.
- **App.tsx**: Uses `InteractionMode` state. `handleCreateObject` creates objects and auto-enters draw mode for arrow/freehand. Keyboard shortcuts updated (V=select, D=draw).
- **PropertiesPanel.tsx**: Added rotation field displaying degrees, storing radians.
- Files modified: `src/types.ts`, `src/lib/annotations.ts`, `src/lib/renderer.ts`, `src/hooks/useProject.ts`, `src/components/AnnotationTools.tsx`, `src/components/App.tsx`, `src/components/PropertiesPanel.tsx`

[2026-03-12] Phase 2 complete: Canvas interaction (select mode)

- **Canvas.tsx**: Complete rewrite with dual-canvas architecture (render canvas + transparent overlay canvas). Overlay handles all mouse interaction and draws selection UI.
  - Coordinate helpers: `clientToNorm` (mouse→normalized), `normToObjectLocal` (undo rotation), `rotatePoint`
  - Hit testing: `hitTestObject` (rotation-aware AABB), `hitTestHandles` (8 resize + 1 rotation handle)
  - Drag-to-move: tracks start position, dispatches `UPDATE_OBJECT_TRANSIENT` on mousemove, `COMMIT_TRANSIENT` on mouseup
  - Resize handles: rotation-aware resize math in `computeResize` — projects mouse delta onto object's local axes, applies anchor-point correction so the opposite corner stays fixed in world space
  - Rotation handle: circle above top-center, tracks angle delta from mousedown to compute new rotation
  - Selection overlay: blue bounding box, 8 white resize handle squares, rotation handle with connecting line
  - Cursor feedback: `move` on selected object body, rotation-adjusted resize cursors on handles, `crosshair` on rotation handle, `pointer` on unselected objects
  - Canvas border: subtle white outline showing export boundary
  - Window-level mousemove/mouseup listeners so dragging outside the canvas works
- **App.tsx**: Now passes `selectedObjectId`, `interactionMode`, `onSelectObject`, `dispatch` to Canvas
- Files modified: `src/components/Canvas.tsx`, `src/components/App.tsx`

[2026-03-12] Phase 3 complete: Canvas interaction (draw mode)

- **Canvas.tsx**: Added draw mode mouse handlers.
  - Arrow objects: each click adds a point to the points array (object-local 0–1 coords via `normToObjectBbox`)
  - Freehand objects: mousedown starts a stroke, mousemove continuously adds points, mouseup commits via `COMMIT_TRANSIENT`
  - Added `draw-freehand` drag state kind for tracking freehand strokes
- **App.tsx**: Added bounding box tightening logic (`tightenBbox`) triggered when switching draw → select mode.
  - Computes tight bbox from point extents with 5% padding
  - Renormalizes points to the new smaller bbox
  - Wrapped `setInteractionMode` in `handleSetMode` to intercept draw→select transitions
- Also: PropertiesPanel now always visible (shows "No object selected" when nothing selected)
- Files modified: `src/components/Canvas.tsx`, `src/components/App.tsx`, `src/components/PropertiesPanel.tsx`

[2026-03-12] Phase 5 complete: Timeline lane dragging

- **Timeline.tsx**: Extended `DragState` 'move' kind with `startMouseY` and `originalLane`. Move drag now uses `UPDATE_OBJECT_TRANSIENT` with `COMMIT_TRANSIENT` on mouseup. Vertical mouse movement calculates target lane via `Math.round(-dy / (LANE_HEIGHT + LANE_GAP))`. During move drags, an extra "new lane" drop zone appears at the top with a dashed blue border and tinted background. Lane count dynamically increases during drag.
- Phase 6 "live position updates" was already working since `UPDATE_OBJECT_TRANSIENT` returns new React state, causing PropertiesPanel to re-render with current values.
- Files modified: `src/components/Timeline.tsx`
