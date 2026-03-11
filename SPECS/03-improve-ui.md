# 03 — Improve UI: Canvas Interaction & Timeline Lane Dragging

## Overview

Expand the basic editor UI with two major interaction improvements:

1. **Canvas object manipulation** — Users can click, drag, resize, and rotate objects directly on the main canvas preview, instead of only using numeric inputs in the Properties Panel.
2. **Timeline lane dragging** — Users can drag timeline bars between lanes (including onto a "new" lane that appears above/below), rather than typing lane numbers in the Properties Panel.

The Properties Panel numeric inputs remain as a secondary/precise editing mechanism.

## Requirements

### Two canvas interaction modes: Select and Draw

The canvas has two mutually exclusive interaction modes, toggled via toolbar buttons:

**Select mode** (default):
1. **Selection on canvas**: Clicking on a visible object selects it. Hit testing uses the object's bounding box (computed from drawing content for arrow/freehand objects).
2. **Move by dragging**: Dragging a selected object updates its `x` and `y` (normalised 0–1 coords) in real time.
3. **Resize by handles**: Selected objects show 8 resize handles (corners + edge midpoints). Dragging a handle updates `width`/`height` (and `x`/`y` for top/left handles).
4. **Rotation**: Selected objects show a rotation handle (above top-center). Dragging it sets `rotation`.
5. **Visual feedback**: Selected objects get a visible bounding box with handles drawn on the canvas overlay, respecting rotation.
6. **Cursor feedback**: Move cursor when hovering a selected object, resize cursors on handles, rotation cursor on rotation handle.

**Draw mode** (for arrow/freehand objects):
1. Only active when an arrow or freehand object is selected.
2. Mouse clicks/drags add lines/points to the selected object's internal point array.
3. Points are recorded in object-local coordinates (0–1 within the object's bounding box).
4. The user stays in draw mode until they switch back to select mode — they can draw as many lines/strokes as needed.
5. The object's bounding box starts at full canvas size (x=0, y=0, w=1, h=1) when first created. After drawing, the bounding box can be tightened to fit the drawn content (with some padding) — or left as-is and tightened on first switch to select mode.

### Annotation creation workflow

1. User clicks "+ Arrow" (or "+ Freehand") button in the toolbar.
2. A new `TimelineObject` is created at full canvas size (x=0, y=0, width=1, height=1) on the top lane, at the current playhead time.
3. The tool automatically switches to **draw mode** with the new object selected.
4. User draws lines/strokes on the canvas. Each click-drag adds to the object's internal point array.
5. When done drawing, user switches to **select mode** (via toolbar button or keyboard shortcut).
6. In select mode, the bounding box shrinks to tightly fit the drawn content (computed from the point array extents, with padding). Points are renormalized to the new smaller box.
7. User can now move, resize, and rotate the object as a unit.

For **text** objects: created at a click position with a default size. Text content is edited via the Properties Panel (or eventually inline editing). No draw mode needed.

For **rectangle/circle** objects: created by click-dragging on the canvas to define the initial bounding box. No draw mode needed — the shape fills its bounding box.

For **photo** objects: created via the Import modal, positioned at full canvas by default. No draw mode.

### Canvas manipulation (select mode)

7. **No clamping** — objects can be dragged partially or fully off-canvas. They'll be clipped at export time.
8. **Canvas border** — the canvas should have a visible border/outline so the user can see the export boundary.

### Timeline Lane Dragging

1. **Vertical drag to change lane**: When dragging an object bar in the timeline, allow vertical movement (not just horizontal). Moving up/down snaps the object to the lane under the cursor.
2. **"New lane" drop targets**: Always show a subtle drop zone above the top lane and below the bottom lane. Dropping onto these creates a new lane (by setting `obj.lane` to `maxLane + 1` or shifting existing lanes).
3. **Visual feedback during drag**: While dragging vertically, highlight the target lane. The bar should visually follow the cursor vertically during the drag.
4. **Combine with existing horizontal drag**: The existing move/resize drag should still work — vertical movement changes lane, horizontal movement changes timing. These can happen simultaneously.

### Properties Panel (keep as-is, plus rotation)

1. Add a **Rotation** field to the Position section showing the current rotation in degrees.
2. Keep all existing numeric inputs for precise editing.

## Technical Considerations

### New `rotation` field on `TimelineObject`

The `TimelineObject` type currently has `x, y, width, height` but no `rotation`. We need to add:

```ts
// In TimelineObject:
rotation: number  // radians, default 0
```

This affects:
- `types.ts` — add `rotation` to `TimelineObject`, default `0` in `createTimelineObject`
- `renderer.ts` — apply `ctx.translate` + `ctx.rotate` before drawing each object
- `PropertiesPanel.tsx` — add rotation input (display as degrees, store as radians)
- Canvas overlay — rotation handle and rotated bounding box

### Key types involved

```ts
// types.ts — existing, relevant
type TimelineObject = {
  id: string
  type: TimelineObjectType
  name: string
  startTime: number
  duration: number
  lane: number
  x: number           // normalised 0–1, position of the object's bounding box on the canvas
  y: number
  width: number        // normalised 0–1, size of the bounding box
  height: number
  rotation: number     // NEW — radians, rotation around center of bounding box
  animateIn: number
  style: ObjectStyle
  data: PhotoData | ArrowData | TextData | ShapeData | FreehandData
}
```

**Coordinate system clarification (critical):**
- `obj.x, obj.y, obj.width, obj.height` — position/size of the bounding box on the *canvas*, normalised 0–1.
- Arrow/freehand `points[].x, points[].y` — currently normalised to the *canvas*. **Must change to be relative to the object's own bounding box (0–1 within the box).** This way, when the box moves/scales, the points inside automatically follow.
- `TextData.x, TextData.y` — same: should become relative to the object's bounding box, or removed entirely (text fills its box).
- `ShapeData.x, y, width, height` — can be removed since the object-level `x, y, width, height` already defines the shape bounds.

This is an **important refactor** of the data model. The annotation-specific data types should only contain data that's *unique* to that annotation type (like arrow head size, text content, whether arrow is curved), NOT positional data — position lives on the `TimelineObject` itself.

```ts
// Simplified after refactor:
type ArrowData = {
  points: { x: number; y: number }[]  // 0–1 relative to THIS object's bounding box
  headSize: number
  curved: boolean
}

type TextData = {
  content: string
  background?: string
  padding?: number
  // x, y REMOVED — text fills its bounding box, positioned by TimelineObject.x/y
}

type ShapeData = {
  // x, y, width, height REMOVED — defined by TimelineObject.x/y/width/height
  // This type may become empty or hold shape-specific props like border-radius
}

type FreehandData = {
  points: { x: number; y: number }[]  // 0–1 relative to THIS object's bounding box
}
```

No new action types needed — `UPDATE_OBJECT` with partial updates covers all canvas manipulations. `UPDATE_OBJECT_TRANSIENT` is needed for drag performance (see undo batching below).

### lineWidth and fontSize scaling

Currently `lineWidth` and `fontSize` are stored as absolute pixel values. When an object's bounding box is resized, these don't scale — a 4px line on a tiny box looks thick, and the same 4px line on a huge box looks thin.

**Solution**: At render time, scale lineWidth/fontSize relative to the object's bounding box. The stored value is treated as "the width at a reference size" (e.g., when the box is full-canvas 1920x1080). When the box is smaller, lineWidth scales down proportionally.

```ts
// In the renderer, before drawing:
const scaleFactor = Math.sqrt((bw * bh) / (canvasW * canvasH))
const effectiveLineWidth = style.lineWidth * scaleFactor
const effectiveFontSize = (style.fontSize ?? 32) * scaleFactor
```

This way the stored values stay as intuitive pixel values (the user sees "4" in the Properties Panel) but they scale visually with the box. The `sqrt(area ratio)` gives a balanced scale that works for both width and height changes.

### Toolbar changes

The current `AnnotationTool` type is `'select' | 'arrow' | 'text' | 'rectangle' | 'circle' | 'freehand'`. This conflates "creation tools" with "interaction modes."

New approach — separate the concepts:
- **Interaction mode**: `'select' | 'draw'` — how mouse events on the canvas behave.
- **Creation actions**: buttons that create a new object and switch to the appropriate mode (draw mode for arrow/freehand, select mode for text/rect/circle).

The toolbar becomes:
- **Select** button (switches to select mode)
- **Draw** button (switches to draw mode — only enabled when an arrow/freehand is selected)
- **+ Arrow** button (creates arrow object, auto-enters draw mode)
- **+ Text** button (creates text object at center, stays in select mode)
- **+ Rectangle** button (creates rect object via click-drag, stays in select mode)
- **+ Circle** button (creates circle object via click-drag, stays in select mode)
- **+ Freehand** button (creates freehand object, auto-enters draw mode)

### Canvas overlay architecture

The current `Canvas.tsx` is a bare `<canvas>` that only renders via `useCanvasRenderer`. For interactive manipulation, we need an **overlay layer** on top of the canvas:

**Option A: HTML overlay div** — Position a transparent div on top of the canvas, handle mouse events there, draw selection handles with CSS/SVG. Simpler but harder to sync rotation transforms with canvas coords.

**Option B: Second canvas overlay** — A transparent `<canvas>` on top of the render canvas, drawn each frame with selection handles/bounding boxes. More work but pixel-perfect alignment with the render canvas.

**Recommended: Option B** — A second canvas handles hit-testing and draws selection UI. Mouse events on this overlay canvas drive object manipulation. The overlay redraws on selection/drag changes.

### Coordinate conversion (critical)

The canvas is displayed at a CSS size that differs from its internal resolution (1920x1080). We need helpers:

```ts
// Convert mouse event coords to normalised 0–1
function clientToNorm(e: MouseEvent, canvas: HTMLCanvasElement): { nx: number; ny: number } {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const px = (e.clientX - rect.left) * scaleX
  const py = (e.clientY - rect.top) * scaleY
  return { nx: px / canvas.width, ny: py / canvas.height }
}
```

### Hit testing with rotation

For rotated objects, hit testing needs to:
1. Translate click point relative to object center
2. Rotate click point by `-rotation`
3. Check if the un-rotated point falls within the un-rotated bounding box

### Rendering with rotation (the "stamp" transform)

In `renderer.ts`, every object gets the same transform sequence:

```ts
ctx.save()
// 1. Transform to the object's bounding box (canvas coords)
const bx = obj.x * w
const by = obj.y * h
const bw = obj.width * w
const bh = obj.height * h
const cx = bx + bw / 2
const cy = by + bh / 2

// 2. Apply rotation around center
ctx.translate(cx, cy)
ctx.rotate(obj.rotation)
ctx.translate(-cx, -cy)

// 3. Draw the object within its bounding box
// Annotation draw functions receive (ctx, data, style, progress, bx, by, bw, bh)
// They draw using object-local coords: pixelX = bx + point.x * bw
drawObject(ctx, obj, progress, bx, by, bw, bh, imageCache)

ctx.restore()
```

This means `drawArrow`, `drawText`, etc. no longer receive canvas `w, h` — they receive the object's pixel-space bounding box. Internal point coords (0–1) are relative to that box.

### Timeline lane drag changes

The current `DragState` type in `Timeline.tsx`:
```ts
type DragState =
  | null
  | { kind: 'move'; objectId: string; startMouseX: number; originalStartTime: number }
  | ...
```

Needs to be extended to track vertical position:
```ts
type DragState =
  | null
  | { kind: 'move'; objectId: string; startMouseX: number; startMouseY: number; originalStartTime: number; originalLane: number }
  | ...
```

During `mousemove` for a `'move'` drag, calculate which lane the cursor is over and update `obj.lane` accordingly.

### Performance considerations

- Canvas overlay redraws should be lightweight — only draw handles/outlines, not re-render all objects
- Dragging dispatches `UPDATE_OBJECT` on every mousemove, which goes through the undo system. Consider batching: only push to undo stack on mouseup, not every mousemove. This may require a new action type like `UPDATE_OBJECT_TRANSIENT` or a flag on the action.
- The current undo system pushes every change. Dragging an object across the canvas could create 100+ undo entries. **This needs to be addressed.**

### Undo batching for drag operations

Options:
1. **Debounced undo push**: Only push to undo stack after a pause in updates (e.g., 300ms of no changes).
2. **Transient update action**: A new `UPDATE_OBJECT_TRANSIENT` action that updates the object without pushing to the undo stack, paired with a `COMMIT` action on mouseup that pushes the current state.
3. **Start/end drag actions**: `BEGIN_DRAG` saves the pre-drag state, `END_DRAG` commits the final state as a single undo entry.

**Recommended: Option 2** — Add `UPDATE_OBJECT_TRANSIENT` to `ProjectAction`. During drag, use transient updates. On mouseup, dispatch a regular `UPDATE_OBJECT` (which will create the undo entry comparing pre-drag to post-drag).

Actually, simpler: save pre-drag snapshot on mousedown, use `UPDATE_OBJECT_TRANSIENT` during drag (mutates present without touching undo stack), on mouseup push the saved snapshot to `past`.

## Related Systems and Tasks

- [warhammer-battle-report-editor-spec.md](../warhammer-battle-report-editor-spec.md) — original project specification
- [SPECS/02-basic-ui.md](02-basic-ui.md) — previous spec that established the current UI
- [src/types.ts](../src/types.ts) — type definitions
- [src/components/Canvas.tsx](../src/components/Canvas.tsx) — current canvas (render only, no interaction)
- [src/components/Timeline.tsx](../src/components/Timeline.tsx) — current timeline (has horizontal drag, no vertical lane drag)
- [src/components/PropertiesPanel.tsx](../src/components/PropertiesPanel.tsx) — numeric property inputs
- [src/hooks/useProject.ts](../src/hooks/useProject.ts) — undo/redo system that needs transient update support

## Resolved Design Decisions

1. **Object model — "rectangular stamp"**: Every object (including arrows, freehand) is a rectangular region on the canvas. The drawing (arrow points, freehand path) is drawn *inside* that rectangle using local coordinates. Moving, rotating, and scaling operate on the rectangle as a whole — individual points are never manipulated after initial drawing. This means:
   - **Move**: updates `x, y` of the rectangle.
   - **Resize**: updates `width, height` of the rectangle. The internal drawing scales proportionally (points are 0–1 relative to the object's own bounding box).
   - **Rotate**: rotates the entire rectangle around its center.
   - Arrow/freehand point arrays use coords relative to the *object's* bounding box, not the canvas. The renderer transforms object-local coords to canvas coords via the object's x/y/width/height/rotation.

2. **Rotation applies to all object types** — since everything is a rectangle, rotation is universal.

3. **No snapping** — deferred to a later iteration.

4. **Single-select only** — no multi-select for now.

5. **Lane === z-order** — dragging to a new lane changes rendering order. That's the purpose of the lane/stack system.

6. **Two interaction modes: Select vs Draw** — Select mode for move/resize/rotate. Draw mode for adding lines/strokes to arrow/freehand objects. User explicitly toggles between them via toolbar or keyboard shortcut. After creating a new arrow/freehand, auto-switch to draw mode.

7. **lineWidth/fontSize scale with bounding box** — Store lineWidth and fontSize as ratios relative to the object's bounding box height (or diagonal). When the box scales, the visual stroke/font scales proportionally. This avoids paper-thin lines on scale-up or bloated lines on scale-down.

8. **No position clamping** — objects can go off-canvas. Export clips them naturally. Canvas shows a visible border so the user knows the boundary.

9. **No saved project migration** — project is WIP. Loading an old/incompatible project just resets to a fresh project.

10. **Draw mode stays active** — after drawing a stroke, stay in draw mode so user can add more lines. Must explicitly switch to select mode when done.

## Open Questions

None — all design questions resolved.

## Acceptance Criteria

### Canvas — Select mode
1. User can click on objects in the canvas to select them (select mode).
2. User can drag selected objects on the canvas to reposition them.
3. Selected objects show resize handles; dragging handles resizes the object.
4. Selected objects show a rotation handle; dragging it rotates the object.
5. Rotation is visually reflected in both the canvas render and the selection overlay.
6. Properties Panel shows rotation value and all position values update live during drag.
7. Objects can be dragged off-canvas without clamping.
8. Canvas has a visible border showing the export boundary.

### Canvas — Draw mode
9. Clicking "+ Arrow" creates an arrow object at full canvas size and enters draw mode.
10. In draw mode, mouse interactions add lines/points to the selected arrow/freehand object.
11. User can draw multiple strokes without leaving draw mode.
12. Switching to select mode tightens the bounding box to fit drawn content and renormalizes points.
13. lineWidth scales proportionally when the bounding box is resized.

### Timeline
14. Dragging a bar vertically moves it to a different lane.
15. Timeline shows "new lane" drop zones above and below existing lanes.
16. Dragging in the timeline can simultaneously change time (horizontal) and lane (vertical).

### General
17. Undo/redo treats an entire drag operation as a single action (not one per mousemove frame).
18. Select mode and draw mode are clearly indicated in the toolbar.

## Implementation Notes

### Suggested file changes

1. **`src/types.ts`** — Data model refactor:
   - Add `rotation: number` to `TimelineObject`, default `0` in `createTimelineObject`
   - Remove positional fields from `TextData` (`x`, `y`) and `ShapeData` (`x`, `y`, `width`, `height`) — position lives on `TimelineObject`
   - Ensure arrow/freehand point coords are documented as object-local (0–1 within the bounding box)
   - Replace `AnnotationTool` type with `InteractionMode = 'select' | 'draw'`
   - Add `UPDATE_OBJECT_TRANSIENT` action type to `ProjectAction`

2. **`src/hooks/useProject.ts`** — Undo batching:
   - Handle `UPDATE_OBJECT_TRANSIENT` — same as `UPDATE_OBJECT` but don't push to undo stack
   - Add `COMMIT_TRANSIENT` action that pushes the saved pre-drag snapshot to `past`

3. **`src/components/Canvas.tsx`** — Major rework:
   - Add overlay canvas on top of render canvas (same size, absolutely positioned)
   - Accept `selectedObjectId`, `onSelectObject`, `interactionMode`, `dispatch` props
   - **Select mode**: mouse events for hit-testing, move, resize handles, rotation handle
   - **Draw mode**: mouse events for adding points/lines to selected arrow/freehand
   - Draw selection bounding box, 8 resize handles, and rotation handle on overlay
   - Coordinate conversion helpers (client → normalised, hit testing with rotation)
   - Visible border around canvas showing export boundary
   - Bounding box tightening logic: when switching from draw → select, compute tight bbox from points and renormalize

4. **`src/lib/renderer.ts`** — Stamp transform:
   - Apply rotation transform around object center before drawing each object
   - Change annotation draw functions to receive object bounding box (bx, by, bw, bh) instead of canvas (w, h)
   - Internal point coords (arrows, freehand) become relative to object box
   - Scale lineWidth/fontSize relative to bounding box size

5. **`src/lib/annotations.ts`** — Update draw signatures:
   - All draw functions change from `(ctx, data, style, progress, w, h)` to `(ctx, data, style, progress, bx, by, bw, bh)`
   - Point-to-pixel conversion changes from `p.x * w` to `bx + p.x * bw`

6. **`src/components/AnnotationTools.tsx`** — Toolbar rework:
   - Replace tool selector with: Select mode button, Draw mode button, creation buttons (+ Arrow, + Text, + Rect, + Circle, + Freehand)
   - Draw button only enabled when arrow/freehand is selected
   - Creation buttons dispatch ADD_OBJECTS and set appropriate mode

7. **`src/components/PropertiesPanel.tsx`**:
   - Add rotation field (display degrees, store radians)

8. **`src/components/Timeline.tsx`** — Lane dragging:
   - Extend `DragState` 'move' kind with `startMouseY` and `originalLane`
   - Track vertical mouse movement during drag
   - Calculate target lane from cursor Y position
   - Render "new lane" drop zones above top / below bottom lane
   - Use transient updates during drag, commit on mouseup

9. **`src/components/App.tsx`** — Wire up new props:
   - Replace `activeTool` state with `interactionMode` state
   - Pass `interactionMode`, `selectedObjectId`, `onSelectObject`, `dispatch` to Canvas
   - Handle creation button clicks (create object + set mode)

### Patterns to follow

- Use `useCallback` for event handlers (existing pattern)
- Normalised coords (0–1) for all positions — convert to/from pixels only at draw/event time
- Dispatch-based state updates (existing pattern)
- Keep `renderer.ts` pure — no mouse/interaction logic there

---

*This specification is ready for implementation. Use `/task 03-improve-ui` to begin development.*
