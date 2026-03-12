# 04-improve-drawing-tools

## Overview

Improve the drawing UX so users can see what they're drawing in real-time, support disconnected freehand strokes, and clean up the toolbar layout.

Currently, when you draw a freehand line (or arrow), the annotation is created at the current scrubber position with an `animateIn` duration, so only the portion of the drawing that has "played through" up to the current time is visible. This means **you see nothing while actively drawing** because the scrubber hasn't moved forward yet.

Additionally, freehand drawing has a gap problem: if you release the mouse and start drawing again, a line is drawn connecting the previous endpoint to the new start point. Users need to be able to draw multiple disconnected strokes within a single freehand object.

## Requirements

### R1: Ghost preview of full annotation when scrubber is within object's time range

- When `globalTime` falls within `[startTime, startTime + duration)` for an annotation, render the **entire** shape.
- The portion that has already "animated in" (i.e., `progress <= 1.0` portion) renders at normal opacity.
- The portion that has NOT yet animated in renders at a reduced "ghost" opacity (~0.25 alpha). Tunable later.
- This applies to all annotation types: freehand, arrow, rectangle, circle, text.
- Photos are excluded — no ghost preview for photos.
- Applies to **all** visible objects, not just the selected one.

### R2: Live drawing feedback at full opacity

- While actively drawing (freehand drag or arrow click-to-add-point), the user must see the stroke appearing on the canvas in real-time at **full opacity** — not ghost opacity.
- Implementation: when drawing is active, force `progress = 1.0` for the object being drawn so it renders at full opacity as points are added.

### R3: Ghost preview should be visually distinct

- Ghost portions should be clearly distinguishable from the "already animated" portions so users understand the timeline relationship.
- Approach: two-pass rendering — draw full shape at ghost opacity first, then draw the animated portion at full opacity on top.

### R4: No change to exported output

- The ghost preview is strictly an **editor preview** feature. When exporting the final video, animate-in behavior is unchanged (progressive reveal only, no ghost).

### R5: Disconnected freehand strokes

- When the user releases the mouse and starts a new stroke (mousedown again), the new stroke must NOT connect to the previous one.
- The freehand object should support multiple disconnected stroke segments.
- All strokes within the object still animate in together as a single object on the timeline.

### R6: Toolbar reorganization

- Remove the standalone "Add Photo" button from the header.
- Add a "+ Image" button to the `AnnotationTools` component, positioned to the left of the existing "+ Arrow" button.
- The "+ Image" button opens the same import modal that "Add Photo" currently opens.

## Technical Considerations

### Key Types

```typescript
// types.ts — current
type FreehandData = {
  points: { x: number; y: number }[]  // 0-1 relative to bounding box
}

// types.ts — new
type FreehandData = {
  strokes: { x: number; y: number }[][]  // array of strokes, each stroke is an array of points (0-1 relative to bbox)
}
```

#### FreehandData change for disconnected strokes (R5)

**Decision: Array-of-strokes approach.** Change `points: Point[]` to `strokes: Point[][]` where each inner array is one continuous pen stroke.

This is the "proper" data model — no sentinel hacks, explicit representation of disconnected strokes. It requires updating all consumers of `FreehandData`:

- `drawFreehand()` in `annotations.ts` — iterate strokes, each gets its own `moveTo`/`lineTo` sequence
- `Canvas.tsx` freehand drawing — mousedown starts a new stroke (pushes a new `[]` onto strokes), mousemove appends to the last stroke
- `tightenBbox()` in `App.tsx` — flatten all strokes to find min/max
- Progress calculation in `drawFreehand()` — count total points across all strokes, then draw strokes progressively

### Current rendering flow

1. `renderFrame()` in `renderer.ts` filters objects to those where `globalTime` is in `[startTime, startTime + duration)`.
2. For each visible object, it computes `progress = min(1, elapsed / animateIn)`.
3. `progress` is passed to each draw function (e.g., `drawFreehand`), which only draws `floor(points.length * progress)` points.
4. At `elapsed = 0` (scrubber right at startTime), `progress ≈ 0` and almost nothing is drawn.

### Ghost preview approach (R1/R3)

**Two-pass rendering in `drawObject()`** when `editorMode` is true and `progress < 1`:
1. First pass: draw with `progress = 1.0`, `opacity *= GHOST_ALPHA` (e.g., 0.25)
2. Second pass: draw with actual `progress`, normal opacity

Slight overdraw where the two passes overlap, but negligible for typical stroke widths.

### Active drawing full opacity (R2)

Pass an optional `activeDrawingObjectId` to `renderFrame()`. When rendering that object, skip the ghost and use `progress = 1.0` at full opacity.

### Files to modify

- **`src/types.ts`** — Change `FreehandData` from `{ points: Point[] }` to `{ strokes: Point[][] }`
- **`src/lib/renderer.ts`** — `renderFrame()` and `drawObject()` to support ghost preview and active drawing override
- **`src/lib/annotations.ts`** — Rewrite `drawFreehand()` to iterate over strokes array; handle progress across total points
- **`src/hooks/useCanvasRenderer.ts`** — Pass `editorMode: true` and `activeDrawingObjectId` when calling `renderFrame()`
- **`src/components/Canvas.tsx`** — Freehand mousedown starts a new stroke in the strokes array; mousemove appends to last stroke. Expose active drawing state.
- **`src/components/App.tsx`** — Update `tightenBbox` to flatten strokes for min/max calc, renormalize per-stroke. Remove "Add Photo" button, pass `onOpenImport` to AnnotationTools.
- **`src/components/AnnotationTools.tsx`** — Add "+ Image" button, accept `onAddImage` callback

### Export safety

`ExportModal` calls `renderFrame()` directly. It must NOT pass `editorMode`, preserving current animate-in behavior.

### Tighten bbox impact

The `tightenBbox` function in `App.tsx` iterates over `points` to find min/max. With the new type, it needs to flatten `strokes` into a single points array for the bounding box calculation, then renormalize each stroke's points to the new bbox.

## Related Systems and Tasks

- [SPECS/03-improve-ui.md](../SPECS/03-improve-ui.md) — Previous UI improvement spec
- [TASKS/03-improve-ui.md](../TASKS/03-improve-ui.md) — Current UI improvement task (in progress on branch `03-improve-ui`)

## Open Questions

*All previously open questions have been resolved.*

## Acceptance Criteria

- [ ] When a freehand/arrow annotation is being drawn, the user sees strokes appearing in real-time at full opacity
- [ ] When the scrubber is within an annotation's time range but before animateIn completes, the full shape is visible as a ghost (~0.25 opacity)
- [ ] The animated portion (what has "played through") renders at full opacity
- [ ] Ghost preview is visually distinct from the fully-animated portion
- [ ] Exported video does NOT include ghost previews — animate-in works as before
- [ ] Ghost preview works for all annotation types (freehand, arrow, rectangle, circle, text) except photos
- [ ] Freehand drawing supports disconnected strokes — releasing and re-clicking starts a new segment without connecting to the previous one
- [ ] "Add Photo" button is removed from the header
- [ ] "+ Image" button appears in AnnotationTools (left of "+ Arrow"), opens the import modal
- [ ] All strokes within a freehand object animate in together as one unit

## Implementation Notes

### Ghost preview: two-pass in `drawObject()`

```typescript
// In drawObject(), when editorMode is true and progress < 1:
if (editorMode && progress < 1 && obj.type !== 'photo') {
  // Pass 1: ghost of full shape
  const ghostStyle = { ...obj.style, opacity: obj.style.opacity * GHOST_ALPHA }
  drawObjectInner(ctx, obj, 1.0, w, h, imageCache, ghostStyle)
  // Pass 2: animated portion at full opacity
  drawObjectInner(ctx, obj, progress, w, h, imageCache, obj.style)
}
```

### `renderFrame()` signature change

```typescript
type EditorOptions = {
  editorMode?: boolean
  activeDrawingObjectId?: string | null
}

renderFrame(ctx, objects, globalTime, { width, height }, imageCache, editorOptions?)
```

### `drawFreehand()` with strokes array

```typescript
function drawFreehand(ctx, data: FreehandData, style, progress, bx, by, bw, bh, scaleFactor) {
  // Flatten all strokes to get total point count for progress calc
  const totalPoints = data.strokes.reduce((sum, s) => sum + s.length, 0)
  if (totalPoints < 2) return

  const drawCount = Math.max(2, Math.floor(totalPoints * progress))

  ctx.save()
  // ... set style ...

  let drawn = 0
  for (const stroke of data.strokes) {
    if (drawn >= drawCount) break
    if (stroke.length === 0) continue

    const pts = stroke.map(p => ({ x: bx + p.x * bw, y: by + p.y * bh }))
    const canDraw = Math.min(pts.length, drawCount - drawn)

    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < canDraw; i++) {
      ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.stroke()
    drawn += canDraw
  }

  ctx.restore()
}
```

### Freehand mousedown/mousemove in Canvas.tsx

```typescript
// mousedown: start a new stroke
const data = selectedObject.data as FreehandData
const newStrokes = [...data.strokes, [{ x: bx, y: by }]]
dispatch({ type: 'UPDATE_OBJECT_TRANSIENT', objectId: ..., updates: { data: { strokes: newStrokes } } })

// mousemove: append to last stroke
const lastStroke = data.strokes[data.strokes.length - 1]
const newStrokes = [
  ...data.strokes.slice(0, -1),
  [...lastStroke, { x: bx, y: by }],
]
```

### Default freehand data

Update `handleCreateObject` in App.tsx:
```typescript
freehand: () => ({ strokes: [] }),  // was: { points: [] }
```

### Toolbar change

Move the import modal trigger into `AnnotationTools` via an `onAddImage` callback prop. Add `{ type: 'photo' as const, label: '+ Image' }` to the front of the creation buttons array, but wire it to the callback instead of `onCreateObject`.
