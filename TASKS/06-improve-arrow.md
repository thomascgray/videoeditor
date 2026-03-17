# 06 - Improve Arrow Drawing UX

**Status**: In Progress

## Overview

Improve the arrow drawing UX with visual feedback (rubber band preview, vertex dots, cursor tooltip), finish gestures (right-click, double-click, Enter), backspace to undo points, 10-point max, and implement curved arrow rendering with a curvature slider.

See [SPECS/06-improve-arrow.md](../SPECS/06-improve-arrow.md) for full specification.

## Task Context

- Arrow points stored as object-local 0-1 coords relative to bounding box
- New arrows start with full-canvas bbox (x:0, y:0, w:1, h:1), tightened on finish via `tightenBbox()` in App.tsx
- Overlay canvas in Canvas.tsx is used for selection handles — extended for arrow drawing feedback
- `ArrowData.curved: boolean` changed to `ArrowData.curvature: number` (-1 to 1). No migration needed.
- Double-click fires after two mousedown events — deduplicates the extra point in `handleDoubleClick`
- `onContextMenu` with `preventDefault` blocks browser menu on right-click in draw mode
- `segmentControlPoint` and `quadBezierAt` exported from annotations.ts for overlay use
- `onFinishArrow` callback passed from App to Canvas to centralize finish logic (tighten + switch mode)
- Backspace in draw mode removes last point; in move mode still deletes object (ordering in keyboard handler matters)

### Key files
- `src/types.ts` — ArrowData type change
- `src/components/Canvas.tsx` — overlay drawing, mouse handlers, tooltip, finish gestures
- `src/lib/annotations.ts` — arrow rendering with bezier curves
- `src/components/App.tsx` — keyboard shortcuts, finish helper, create defaults
- `src/components/PropertiesPanel.tsx` — curvature slider

## Blockers/Issues

None currently

## TODO

- [X] Change `ArrowData.curved: boolean` to `curvature: number` in types.ts and all references
- [X] Implement bezier curve rendering in drawArrow() with proper arrowhead angles
- [X] Add curvature slider to PropertiesPanel (double-click to reset to 0)
- [X] Add mouse position tracking ref in Canvas.tsx
- [X] Draw vertex dots on overlay when in draw mode with arrow selected
- [X] Draw rubber band preview line (dashed, curves with curvature) from last point to cursor
- [X] Add cursor tooltip showing contextual instructions
- [X] Implement right-click to place final point and finish
- [X] Implement double-click to place final point and finish (with dedup)
- [X] Add Enter key to finish arrow, Backspace to remove last point
- [X] Enforce 10-point maximum with auto-finish
- [ ] Manual testing and polish

## Work Log

[2026-03-17] Implemented all arrow UX improvements

- Files modified: src/types.ts, src/lib/annotations.ts, src/components/Canvas.tsx, src/components/App.tsx, src/components/PropertiesPanel.tsx
- Changed `ArrowData.curved: boolean` to `curvature: number` (-1 to 1)
- Rewrote `drawArrow()` with bezier curve support, proper length approximation for animation, De Casteljau split for partial progress, and correct arrowhead tangent angles
- Added curvature slider in PropertiesPanel (range -1 to 1, double-click to reset)
- Added overlay drawing: vertex dots with white border, dashed rubber band preview line (curves when curvature != 0)
- Added cursor tooltip that changes based on point count
- Added right-click (contextmenu) to place final point and finish
- Added double-click to finish (with point deduplication)
- Added Enter to finish, Backspace to remove last point
- Enforced 10-point maximum with auto-finish
- Exported `segmentControlPoint` and `quadBezierAt` from annotations.ts for overlay reuse
- Added `onFinishArrow` callback prop to Canvas, implemented in App.tsx
