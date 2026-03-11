# 02-basic-ui — Timeline-Based Video Editor UI

## Overview

Rearchitect the app from a **slide-based** model to a **timeline-based** model, matching the UX of standard video editors (DaVinci Resolve, Premiere, CapCut, etc.).

Currently, the app treats "slides" as the primary unit — each slide has a photo and annotations scoped to it. The new model removes slides entirely and replaces them with **timeline objects**: photos, text boxes, arrows, shapes, etc. are all first-class objects placed on a shared timeline with start times and durations.

## Requirements

### Data Model

1. **Replace `Slide[]` with `TimelineObject[]`** — the project contains a flat list of objects, each with a global start time and duration.
2. **Object types**: `photo`, `arrow`, `text`, `rectangle`, `circle`, `freehand` (extensible later).
3. **Photos are just objects** — a photo has a position (x, y), size (width, height), a start time, and a duration. It renders as an image on the canvas at those coordinates during that time window.
4. **Annotations are also objects** — arrows, text, shapes all sit on the same timeline as photos. They have their own start time, duration, and canvas position.
5. **Z-ordering via lanes** — each object sits on a lane in the timeline. Higher lane = renders on top (foreground). This is the z-order mechanism — no separate z-index needed beyond lane assignment.
6. **All coordinates remain normalised (0–1)** — this is preserved from the current architecture.
7. **Empty project = 0-second video** — total duration is always derived from objects. No objects means no video. Adding a photo and dragging its bar wider increases the video duration.

### UI Layout

7. **No sidebar** — remove the slide list sidebar entirely.
8. **Main viewport** — the canvas preview dominates the center/top of the screen. Shows the composited frame at the current playback time.
9. **Timeline panel at the bottom** — a horizontal timeline where each object is a coloured bar showing its start time and duration. Users can:
   - Drag bars left/right to change start time
   - Drag bar edges to change duration
   - Click a bar to select that object
   - See a playhead (vertical line) showing current time
10. **Add objects** — a toolbar or menu to add new objects (import photo, add text, add arrow, etc.). The existing ImportModal can be reused for photo import.
11. **Properties panel** — when an object is selected, show its properties on the right (or as a floating panel): position, size, style, timing. Similar to the current AnnotationPanel but unified for all object types.
12. **Playback controls** — play/pause, seek via clicking on the timeline, playhead scrubbing.

### Viewport Interaction

13. **Select & move objects on canvas** — click an object in the viewport to select it, drag to reposition.
14. **Drawing tools** — arrow, text, rectangle, circle, freehand tools work by drawing on the viewport, which creates a new timeline object at the current playhead position with a default duration.
15. **Resize handles** — selected objects show handles for resizing (at minimum for photos and shapes).

### Migration from Current Architecture

16. **Remove Slide concept** — `Slide` type, `createSlide()`, slide-related actions (`ADD_SLIDES`, `REMOVE_SLIDE`, `REORDER_SLIDES`, `UPDATE_SLIDE`, `DUPLICATE_SLIDE`) all get replaced.
17. **Preserve renderer core** — `renderFrame()` logic is adapted: instead of rendering one slide's photo + annotations, it composites all visible objects at a given global time.
18. **Preserve export pipeline** — `ffmpegExport.ts` and `useFFmpegExport.ts` continue to work, just calling the updated `renderFrame()`.
19. **Preserve undo/redo** — the `useProject` reducer pattern stays, just with new action types.
20. **Preserve localStorage persistence** — same pattern, new data shape.

## Technical Considerations

### Current Types (to be replaced)

```typescript
// CURRENT — being removed
type Slide = {
  id: string
  photoSrc: string
  duration: number
  annotations: Annotation[]
}

type Project = {
  id: string; name: string; fps: number; width: number; height: number
  slides: Slide[]
}
```

### Proposed New Types

```typescript
type TimelineObjectType = 'photo' | 'arrow' | 'text' | 'rectangle' | 'circle' | 'freehand'

type TimelineObject = {
  id: string
  type: TimelineObjectType
  name: string               // user-facing label, e.g. "Photo 1", "Arrow 3"
  startTime: number          // global seconds — when this object appears
  duration: number           // seconds — how long it's visible
  lane: number               // timeline lane index — higher lane = renders on top (foreground)

  // Canvas positioning (normalised 0–1)
  x: number
  y: number
  width: number              // for photos/shapes; ignored for freehand/arrows
  height: number

  // Animation
  animateIn: number          // seconds — draw-on animation duration (0 = instant)

  // Visual style
  style: ObjectStyle

  // Type-specific payload
  data: PhotoData | ArrowData | TextData | ShapeData | FreehandData
}

type PhotoData = {
  src: string                // base64 data URL
}

// ArrowData, TextData, ShapeData, FreehandData — same as current

type ObjectStyle = {
  color: string
  lineWidth: number
  opacity: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
}

type Project = {
  id: string
  name: string
  fps: number
  width: number              // default 1920
  height: number             // default 1080
  objects: TimelineObject[]
}
```

### Key Differences from Current Model

| Aspect | Current (Slide-based) | New (Timeline-based) |
|---|---|---|
| Primary unit | Slide (photo + annotations) | TimelineObject |
| Photo handling | One photo per slide, always full-canvas | Photo is an object with position/size |
| Annotation timing | `appearAt` relative to slide start | `startTime` is global, absolute |
| Annotation scoping | Nested inside a slide | All objects are peers at top level |
| Visibility | Annotation visible during its slide | Object visible during its `[startTime, startTime + duration]` window |
| Z-ordering | Annotation array order within slide | Lane position — higher lane = foreground |
| Navigation | Slide-to-slide (prev/next) | Continuous timeline with playhead |

### Renderer Changes

`renderFrame()` signature changes:

```typescript
// NEW
function renderFrame(
  ctx: CanvasRenderingContext2D,
  objects: TimelineObject[],     // all project objects
  globalTime: number,            // current playback position
  options: { width: number; height: number },
  imageCache: Map<string, HTMLImageElement | ImageBitmap>  // pre-loaded photos
): void
```

Pipeline per frame:
1. Fill canvas with **black** background
2. Filter to objects visible at `globalTime` (where `globalTime` is within `[startTime, startTime + duration]`)
3. Sort visible objects by `lane` ascending (lowest lane = background, drawn first)
4. For each visible object:
   - Calculate animation progress based on `animateIn`
   - Draw object at its (x, y, width, height) position
5. Photos render as images; annotations render as before

### Timeline UI Component

The timeline is the most significant new UI piece. It's a multi-lane horizontal track area at the bottom of the screen.

**Structure:**
- Multiple horizontal **lanes** stacked vertically. Each lane is a row.
- Higher lanes (visually higher in the panel) = higher z-order (foreground).
- Each object is a coloured **bar** on its lane, positioned left-to-right by `startTime`, width proportional to `duration`.
- A vertical **playhead** line spans all lanes, showing the current time. Draggable to seek.

**Interactions:**
- **Drag bar left/right** — changes `startTime`
- **Drag bar left/right edges** — changes `duration` (resize)
- **Click bar** — selects the object (highlights in viewport too)
- **Drag bar up/down between lanes** — changes z-order
- **Click empty area on timeline** — seeks playhead to that time

**Visual:**
- Bars colour-coded by type (e.g. blue for photos, red for arrows, green for text)
- Selected bar has a highlight/border
- Time ruler along the top showing seconds
- Zoom controls (seconds-per-pixel) for navigating long timelines

**Duration:**
- Total timeline length = latest `startTime + duration` of any object
- If no objects, timeline is empty (0 seconds)

### What We Keep

- `renderer.ts` core drawing functions (`drawArrow`, `drawText`, `drawRectangle`, `drawCircle`, `drawFreehand`) — largely unchanged
- `ffmpegExport.ts` — export loop adapted to call new `renderFrame()`
- `useFFmpegExport.ts` — hook unchanged
- `projectStorage.ts` — same pattern, new schema
- `ImportModal.tsx` — reused for adding photos (now creates photo timeline objects instead of slides)
- `AnnotationTools.tsx` — toolbar for selecting draw tool, mostly unchanged
- `ExportModal.tsx` — unchanged
- Undo/redo pattern from `useProject.ts` — new action types but same architecture

### What Gets Removed

- `Sidebar.tsx` — no more slide list
- `SlidePanel.tsx` — no slide concept
- `usePlayback.ts` — rewritten (no more slide-based time calculation)
- Slide-related types and actions

### What's New

- `Timeline.tsx` — the bottom timeline panel (largest new component)
- `TimelineTrack.tsx` — individual object bar rendering
- Updated `usePlayback.ts` — simpler: just global time, no slide mapping
- Updated `useProject.ts` — new actions for timeline objects
- Updated `Canvas.tsx` — handles object selection/drawing on the viewport
- `PropertiesPanel.tsx` — unified panel replacing AnnotationPanel + SlidePanel

## Related Systems and Tasks

- [warhammer-battle-report-editor-spec.md](../warhammer-battle-report-editor-spec.md) — original project spec (slide-based, to be superseded by this)
- [TASKS/](../TASKS/) — existing task tracking

## Resolved Questions

1. **Background colour** — **Black.** When no photo covers the canvas, the background is solid black.
2. **Photo default size** — **Full-canvas.** Imported photos default to `x:0, y:0, width:1, height:1` (fill the entire viewport). Users can then resize/reposition.
3. **Object snapping** — **No.** No snapping on timeline or canvas. Keep it simple.
4. **Layer panel** — **No separate panel.** Z-order is determined by the timeline lanes: a bar on a higher lane renders on top of a bar on a lower lane at the same time position. This is standard video editor behaviour.
5. **Timeline lanes** — **Multiple lanes.** Each object occupies a lane. If two objects overlap in time, they appear on separate lanes. The vertical position of a lane determines z-order: higher lane = renders on top (foreground). This matches Premiere/DaVinci.
6. **Max duration** — **Auto-calculated.** Total video duration = the latest `startTime + duration` of any object. If the timeline is empty, duration is 0. Explicit padding may be added later.
7. **Transitions** — **Hard cuts only for now.** Objects simply appear and disappear at their start/end times. Transitions/animations are a future enhancement.

## Open Questions

(None currently — all resolved.)

## Acceptance Criteria

- [ ] No `Slide` type or sidebar in the codebase
- [ ] Project data model uses `TimelineObject[]` instead of `Slide[]`
- [ ] Timeline panel at bottom shows all objects as draggable bars
- [ ] Playhead on timeline, draggable to seek
- [ ] Clicking an object bar selects it; properties panel shows on the right
- [ ] Photos render on canvas at their specified position/size during their time window
- [ ] Annotations (arrows, text, shapes) render on canvas during their time window with animation
- [ ] Drawing tools create new timeline objects at the current playhead position
- [ ] Play/pause works across the full timeline
- [ ] Export produces correct video with all objects composited
- [ ] Undo/redo works for all operations
- [ ] Project saves/loads correctly with new data model

## Implementation Notes

### Suggested Build Order

1. **New types** — define `TimelineObject`, new `Project` shape, new actions
2. **Adapt renderer** — update `renderFrame()` to work with `TimelineObject[]` + global time
3. **Update useProject** — new reducer actions for timeline objects
4. **Update usePlayback** — simplify to pure global time (no slide calculation)
5. **Basic viewport** — render visible objects at current time
6. **Timeline component** — the big new UI piece; start with static bars, then add drag interactions
7. **Properties panel** — unified object editor
8. **Drawing tools on viewport** — create timeline objects when drawing
9. **Photo import** — adapt ImportModal to create photo objects
10. **Export** — adapt export loop to new renderFrame
11. **Remove old code** — delete Sidebar, SlidePanel, slide types/actions
12. **Polish** — keyboard shortcuts, selection UX, timeline zoom

### Component Responsibility Sketch

```
App.tsx
├── TopBar (project name, play/pause, export button)
├── MainArea
│   ├── Viewport (Canvas.tsx — renders frame, handles drawing/selection)
│   └── PropertiesPanel (selected object properties — right side or floating)
├── Toolbar (AnnotationTools — draw tool selection)
└── Timeline (new — bottom panel, object bars, playhead, scrubbing)
```
