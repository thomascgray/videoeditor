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
- [ ] Add `rotation: number` to `TimelineObject` and default it to `0` in `createTimelineObject`
- [ ] Remove positional fields from `TextData` (x, y) and `ShapeData` (x, y, width, height)
- [ ] Update annotation draw functions to use object bounding box instead of canvas w/h
- [ ] Update renderer.ts to apply rotation transform and pass bounding box to drawers
- [ ] Add lineWidth/fontSize scaling relative to bounding box
- [ ] Replace `AnnotationTool` type with `InteractionMode = 'select' | 'draw'`
- [ ] Add `UPDATE_OBJECT_TRANSIENT` and undo batching support to useProject.ts

### Phase 2: Canvas interaction (select mode)
- [ ] Add overlay canvas to Canvas.tsx
- [ ] Implement coordinate conversion helpers (client → normalised, hit testing with rotation)
- [ ] Implement click-to-select (hit testing on canvas objects)
- [ ] Implement drag-to-move selected objects
- [ ] Implement resize handles (8 handles: corners + edge midpoints)
- [ ] Implement rotation handle (above top-center)
- [ ] Draw selection bounding box, resize handles, rotation handle on overlay
- [ ] Cursor feedback (move, resize, rotation cursors)
- [ ] Add visible canvas border showing export boundary

### Phase 3: Canvas interaction (draw mode)
- [ ] Implement draw mode for arrow objects (click-drag adds line segments)
- [ ] Implement draw mode for freehand objects (click-drag adds points)
- [ ] Auto-enter draw mode when creating new arrow/freehand
- [ ] Bounding box tightening on switch from draw → select mode (compute tight bbox, renormalize points)

### Phase 4: Toolbar rework
- [ ] Replace AnnotationTools.tsx with new toolbar: Select/Draw mode buttons + creation action buttons
- [ ] Wire creation buttons to create objects + set appropriate mode
- [ ] Update App.tsx to use `interactionMode` instead of `activeTool`

### Phase 5: Timeline lane dragging
- [ ] Extend DragState 'move' kind with startMouseY and originalLane
- [ ] Track vertical mouse movement during timeline drag
- [ ] Calculate target lane from cursor Y position and update obj.lane
- [ ] Render "new lane" drop zones above top / below bottom lane
- [ ] Use transient updates during drag, commit on mouseup

### Phase 6: Properties Panel updates
- [ ] Add rotation field (display degrees, store radians)
- [ ] Ensure position values update live during canvas drag

## Work Log
