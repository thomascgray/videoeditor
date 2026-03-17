# 06 - Improve Arrow Drawing UX

## Overview

The arrow placement experience is confusing and janky. Users don't understand what clicking does, dragging does nothing (silently), and there's no visual feedback during the drawing process. This spec aims to make the arrow drawing workflow clear, intuitive, and satisfying — and also implement the `curved` arrow feature that exists in the type system but was never built.

## Current Behavior (Problems)

1. **No preview line**: After placing the first point, there's no line from the last point to the cursor showing where the next segment will go
2. **Nothing visible after first click**: Arrow requires 2+ points to render (`if (points.length < 2) return`), so the first click produces zero visual feedback
3. **Dragging is silently ignored**: In draw mode for arrows, `mousedown` adds a point but `mousemove` does nothing — user drags and nothing happens, which feels broken
4. **No vertex indicators**: Existing placed points aren't visually marked, so the user can't see the path structure
5. **No "how to use" hint**: Nothing tells the user "click to place points" or how to finish
6. **No way to undo last point**: Only full undo (Ctrl+Z) which undoes the whole last action
7. **No explicit "finish" gesture**: User must switch modes or deselect to end drawing — no double-click or Enter to finish
8. **First-click dot missing**: A visual dot should appear at the first placed point so the user knows something happened
9. **Curved arrows not implemented**: `ArrowData.curved` exists as a boolean but rendering always draws straight segments. No UI to control curvature.

## Requirements

### R1: Preview Line (Rubber Band)
While in draw mode with an arrow selected that has 1+ points, draw a dashed line from the last placed point to the current cursor position. This gives immediate feedback about where the next segment will go.

### R2: First-Point Indicator
When the user places the first point, render a visible dot/circle at that location so they know something happened and where their arrow starts.

### R3: Vertex Dots
Show small dots at each placed point in the arrow path while in draw mode. This helps the user understand the shape they're building.

### R4: Cursor Tooltip Hint
Show a small tooltip near the cursor that changes based on state:
- **No points placed**: "Click to place first point"
- **1 point placed**: "Click to add points. Right-click to finish."
- **2+ points placed**: "Click to add points. Right-click to place last point and finish."

The tooltip should follow the cursor at a small offset (e.g. 15px below and to the right), styled as a small semi-transparent dark pill with white text.

### R5: Finish Gestures
Multiple ways to finish drawing an arrow:
- **Right-click**: Places the final point at cursor position and finishes (exits draw mode, tightens bbox)
- **Enter key**: Finishes the arrow without placing a new point
- **Double-click**: Places the final point and finishes
- **Escape**: Cancels / exits draw mode (existing behavior, switches to move)

### R6: Backspace to Remove Last Point
While in draw mode with an arrow selected, pressing Backspace should remove the last placed point. If all points are removed, the arrow remains selected in draw mode (user can start over). Ctrl+Z continues to work as full undo.

### R7: Maximum 10 Points
Enforce a maximum of 10 points per arrow. When the limit is reached, auto-finish the arrow (same as right-click finish behavior). Update the tooltip to say "Click to place last point (max reached)" when at 9 points.

### R8: Ignore Drag (Keep Current, But Better)
Dragging should continue to not draw a freehand line for arrows — arrows are point-to-point. The rubber band preview (R1) during drag makes this feel natural since the user sees the line following their cursor.

### R9: Curve Slider in Properties Panel
Replace the `curved: boolean` field with a `curvature: number` ranging from -1 to 1:
- **0** = straight segments (default)
- **Positive values** = curve to the right of the travel direction
- **Negative values** = curve to the left of the travel direction

Display as a range slider in the Properties Panel under a new "Arrow" section (only shown when an arrow is selected). The slider should have center-zero behavior with a visible center tick mark. Label: "Curvature".

### R10: Curved Arrow Rendering
When `curvature !== 0`, render the arrow path using quadratic bezier curves instead of straight line segments. For each segment between consecutive points, compute a control point offset perpendicular to the segment, scaled by the curvature value. This produces a smooth curve through the placed points.

The rubber band preview line (R1) should also curve when curvature is non-zero, giving immediate visual feedback.

## Technical Considerations

### Type Changes

```typescript
// src/types.ts — ArrowData modification
export type ArrowData = {
  points: { x: number; y: number }[]  // 0–1 relative to object's bounding box
  headSize: number
  curvature: number  // -1 to 1, replaces `curved: boolean`. 0 = straight.
}
```

This is a **breaking change** to ArrowData. Need to handle migration of existing `curved: boolean` → `curvature: number` (map `false` → `0`, `true` → `0.5` or similar). Since there's no persistence layer yet (no save/load), this is just about updating all references.

### Key Files to Modify
- **[types.ts](src/types.ts)**: Change `ArrowData.curved` → `ArrowData.curvature`
- **[Canvas.tsx](src/components/Canvas.tsx)**: Mouse event handlers, overlay drawing (rubber band, vertex dots, tooltip), right-click handler, double-click handler
- **[annotations.ts](src/lib/annotations.ts)**: `drawArrow()` — add bezier curve rendering path, update arrowhead angle calculation for curves
- **[App.tsx](src/components/App.tsx)**: Keyboard shortcuts (Enter to finish, Backspace to remove point), default data for new arrows (`curvature: 0`)
- **[PropertiesPanel.tsx](src/components/PropertiesPanel.tsx)**: Add "Arrow" section with curvature slider

### Coordinate System Notes
- Arrow points are stored in **object-local 0–1 coords** relative to the bounding box
- The bounding box starts at full canvas (x:0, y:0, w:1, h:1) for new arrows
- `normToObjectBbox()` converts canvas-normalized coords to object-local coords
- When drawing finishes, `tightenBbox()` shrinks the bbox to fit the actual points

### Overlay Drawing Approach
The overlay canvas (`overlayCanvasRef`) in Canvas.tsx is the right place for the rubber band line and vertex dots — it's already used for selection handles. The `drawOverlay` callback needs extending. Need to track mouse position in a ref (currently only tracked during drag).

### Bezier Curve Math
For each segment from point A to point B with curvature `c`:
1. Compute midpoint M = (A + B) / 2
2. Compute perpendicular direction: `perp = normalize(rotate90(B - A))`
3. Control point = `M + perp * c * segmentLength * 0.5`
4. Draw with `ctx.quadraticCurveTo(cp.x, cp.y, B.x, B.y)`

The arrowhead angle needs to use the tangent at the end of the last bezier segment, not the straight-line angle.

### Double-Click Point Deduplication
The `dblclick` event fires after two `mousedown`/`mouseup` pairs. This means two points will be added by the regular click handler before the double-click fires. The double-click handler should remove the extra point (pop the last one) before finishing.

### Right-Click Context Menu Prevention
Need `onContextMenu` with `e.preventDefault()` on the canvas when in draw mode to prevent the browser context menu.

## Related Systems and Tasks

- [SPECS/04-improve-drawing-tools.md](SPECS/04-improve-drawing-tools.md) — previous drawing tool improvements
- [SPECS/05-qol-stuff.md](SPECS/05-qol-stuff.md) — QoL improvements

## Open Questions

*All questions resolved.*

## Acceptance Criteria

- [ ] After clicking the first point, a visible dot appears at that location
- [ ] A dashed preview line follows the cursor from the last placed point
- [ ] Preview line curves when curvature is non-zero
- [ ] Small dots are visible at each placed vertex while in draw mode
- [ ] Right-clicking places a final point and finishes the arrow
- [ ] Double-clicking places a final point and finishes the arrow
- [ ] Pressing Enter finishes the arrow without adding a point
- [ ] Pressing Backspace in draw mode removes the last placed point
- [ ] A cursor tooltip tells the user what to do at each stage
- [ ] Maximum of 10 points enforced, auto-finishes at limit
- [ ] Curvature slider appears in Properties Panel for arrows (range -1 to 1, default 0)
- [ ] Arrows render as bezier curves when curvature is non-zero
- [ ] Arrowhead angle is correct for curved arrows
- [ ] Dragging feels natural because the rubber band line follows the cursor
- [ ] The overall flow feels clear: create arrow → click points → finish → move/resize

## Implementation Notes

1. **Add mouse position tracking to Canvas**: Store `mouseNormPos` in a ref, update on every `mousemove`. Trigger `drawOverlay` on mouse move when in draw mode with arrow selected.

2. **Extend `drawOverlay` in Canvas.tsx**: When in draw mode with an arrow selected:
   - Draw filled dots at each existing point (convert from object-local to canvas coords)
   - Draw dashed line (or curve) from last point to current mouse position
   - Use the arrow's color from `style.color` for consistency

3. **Add `onDoubleClick` and `onContextMenu` to overlay canvas**:
   - `onDoubleClick`: Pop the duplicate point, add final point, finish
   - `onContextMenu`: `e.preventDefault()`, add point at cursor, finish

4. **Handle Enter/Backspace in App.tsx keyboard handler**:
   - Enter in draw mode with arrow that has 2+ points → finish (tighten + switch to move)
   - Backspace in draw mode with arrow → remove last point from arrow data

5. **Cursor tooltip**: Absolutely-positioned div as sibling to the canvas container, positioned via mouse event coords. Rendered conditionally in Canvas component. Style: `bg-black/75 text-white text-xs px-2 py-1 rounded pointer-events-none`.

6. **Curvature slider in PropertiesPanel**: Add an arrow-specific section with a range input, min=-100 max=100 step=1, mapping to -1..1. Show a center tick or label "Straight" at center.

7. **Update `drawArrow` in annotations.ts**: When `curvature !== 0`, use `quadraticCurveTo` for each segment. Compute arrowhead angle from the derivative of the last bezier at t=1 (which is `2*(P2 - CP)` for a quadratic bezier).

8. **Finish helper**: Extract a shared `finishArrowDrawing()` function in App.tsx (or passed as callback to Canvas) that handles: tighten bbox → switch to move mode. Used by double-click, right-click, Enter, and max-points-reached.

---
*This specification is ready for implementation. Use `/task 06-improve-arrow` to begin development.*
