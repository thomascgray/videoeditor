# 13-camera-zoom

## Overview

Add **camera zooms** — a way to punch the "camera" in on a region of the canvas for a stretch of time, then pull back out, à la a screen-recording tool (Screen Studio etc.). The camera is applied as a **single global `ctx.translate/scale` transform in `renderFrame`**, in front of the existing object loop. Because object coordinates are already normalized 0–1, this composes over every object for free and — critically — works **identically in preview and export** because both share `renderFrame`.

Two design decisions shape this feature, both refinements of the user's proposal:

1. **Authoring happens un-zoomed, playback/export happens zoomed.** While you're setting up a zoom, the canvas stays at full frame and the zoom is shown as a **bright framing rectangle with a grey scrim** over the cropped-out area (the "grey overlay"). You author by dragging that rectangle. A **Live/WYSIWYG toggle** (and every export) applies the *real* transform so you can confirm the actual result. This keeps the whole scene visible + editable during authoring **and** preserves preview==export — you get both.
   - *Why this matters technically:* editing objects only ever happens in the un-zoomed Frame view, so we **never need to invert the camera transform for hit-testing/overlay** in v1 (the hardest part of a naïve camera). Live view is playback-only.

2. **The camera is authored as discrete "zooms", not raw keyframe tracks.** Each zoom is a `{x, y, scale}` target plus timing (`startTime`, `transitionIn`, `hold`, `transitionOut`, `easing`). The renderer *compiles* the list of zooms into an effective camera pose at each time. This is a friendlier mental model than camera keyframe diamonds and maps cleanly onto both the panel (type x/y/scale) and the canvas (drag a rectangle).

This is still a **thin layer on the spec-12 easing engine** — it reuses `ease(kind,u)` / `lerp` / `clamp01` from `src/lib/easing.ts`, but **not** the whole-pose `Keyframe[]` machinery (that's for per-object animation; the camera has its own simpler segment model).

### What exists today (grounded, re-verified 2026-07-09 — spec 12 has shipped)

- **No camera concept anywhere.** `Project` (`types.ts:128-136`) is `id/name/fps/width/height/objects/assets` — nothing else. `ProjectAction` (`types.ts:144-156`) has no camera action. Repo-wide there is zero `ctx.scale`/`ctx.setTransform`/`camera`/`viewport` usage; the only `ctx.translate`/`ctx.rotate` are per-object rotation-about-center (`renderer.ts:98-102`, and the overlay in `Canvas.tsx:499-503`).
- **`renderFrame` is the single shared choke-point** (`renderer.ts:22`): both preview (`useCanvasRenderer.ts:45`) and export (`ffmpegExport.ts` / worker) call it with a clean, untransformed ctx. It fills a black background (`renderer.ts:35-36`), filters to visible objects, sorts by lane, then in the loop calls `resolveRenderPose(rawObj, globalTime)` (keyframes + enter/exit from spec 12, `keyframes.ts:169`) before `drawObject`. **Wrapping the object loop (`renderer.ts:43-69`) in `ctx.save(); <camera transform>; …; ctx.restore()` after the background fill = a global camera on preview + export at once.**
- **The overlay is a *separate* canvas** (`Canvas.tsx:919-937` stacks a render canvas + an overlay canvas). `drawOverlay` (`Canvas.tsx:407-572`) paints the canvas border, selection box, resize/rotate handles, and the arrow rubber-band in **pixel space**, and the overlay element owns all mouse events. It does **not** pass through `renderFrame`. This overlay is exactly where the **framing rectangle + grey scrim** get drawn.
- **Screen→scene mapping assumes identity camera.** `clientToNorm` (`Canvas.tsx:70-79`) maps a mouse event to normalized 0–1 via `getBoundingClientRect`; all hit-testing (`hitTestObject`/`hitTestHandles`, `Canvas.tsx:137-192`) assumes no camera transform. **In the Frame-view authoring model this assumption stays valid** (objects are edited un-zoomed), so no inverse transform is needed for object editing in v1.
- **Selection already resolves through the animation layer.** `Canvas.tsx:395-397` derives `selectedObject = resolvePose(raw, globalTime)`; both drag paths dispatch via `editPose` (`keyframes.ts:185`). The camera sits *outside* this per-object layer, so it doesn't disturb it.
- **`resolveRenderPose` = keyframes + enter/exit** (`keyframes.ts:169-171`) — the camera composes *around* this (camera transform wraps the whole loop; per-object poses are unchanged).
- **Stroke/font scaling precedent:** `drawObject` scales line widths/fonts by `scaleFactor = sqrt((w*h)/(1920*1080))` (`renderer.ts:92-93`) — a global `ctx.scale` additionally scales strokes/fonts with zoom, which is the desired "it's a real camera, everything zooms together" behavior.
- **No devicePixelRatio handling; backing store = raw project dims** (`Canvas.tsx:379-387`). CSS letterboxes the fixed-resolution buffer.
- **Not to be confused with** `Timeline.tsx`'s horizontal `pixelsPerSecond` mouse-wheel "zoom" — that's timeline scale, unrelated to the canvas camera.

## Requirements

### Camera model + transform
- **R1**: Add a project-level list of **zooms**: `Project.zooms?: CameraZoom[]` (additive, backward-compatible). Each `CameraZoom` targets a focal point `(x, y)` (normalized 0–1, held at screen center) and a `scale ≥ 1` (`1` = full frame, `2` = 2× punch-in), over a timing envelope (`startTime`, `transitionIn`, `hold`, `transitionOut`, `easing`). `scale < 1` (zoom-out past the frame) is out of scope for v1.
- **R2**: A pure `resolveCamera(zooms, globalTime): CameraState` compiles the list into the effective `{x, y, scale}` at any global time. Each zoom **eases in from wherever the camera already is at its `startTime`** (full frame if the camera was idle, **or the previous zoom's pose — enabling A→B chaining**), holds at its target, then eases back toward full frame over `transitionOut` unless the next zoom takes over first. **When no zoom is active the camera is exactly full frame `{x:0.5, y:0.5, scale:1}`.** Uses spec-12 `ease()`.
- **R3**: `renderFrame` applies the resolved camera as a single transform after the background fill and before the object loop. A project with **no zooms — or the camera at full frame — renders pixel-identically to today** (preview + export).
- **R4**: The camera applies identically in **export** (guaranteed by living in `renderFrame`; export always renders the real transform). Exported MP4 shows the same push-ins as Live-view preview.

### Frame view (authoring) vs. Live view (WYSIWYG)
- **R5**: **Frame view (default authoring view):** the render canvas is **not** transformed — the full frame stays visible. The overlay draws the currently-resolved camera region as a **bright framing rectangle** with a **grey scrim** dimming everything outside it. As the playhead moves, the rectangle animates (glides + tightens) tracking `resolveCamera`, so the move is visible without the pixels cropping.
- **R6**: **Live view (toggle):** the render canvas applies the real camera transform (identical to export). Live view is **playback/confirmation only** — object selection handles are hidden and object editing is disabled while in Live view (so no inverse-transform hit-testing is required in v1).
- **R7**: The Frame/Live toggle is a single, obvious control (e.g. a canvas-corner button or a keyboard shortcut). Default = Frame view. The toggle is a pure view state (not persisted to the project, not part of undo).

### Authoring zooms
- **R8**: Creating a zoom via the **`+ Zoom` CTA** (R14) drops a `CameraZoom` at the current playhead with default `{x,y,scale}` + timing, auto-selects it, and switches the canvas to **Frame view**. The user then **frames it by dragging/resizing its framing rectangle** on the canvas. (Optional nicety: a "draw a rectangle" gesture that sets `{x,y,scale}` in one stroke — the editor expands the drawn rect to the project aspect ratio so nothing is cut.)
- **R9**: A zoom's target rectangle is **selectable and editable on the canvas** — moving/resizing the framing rectangle updates `{x, y, scale}` (reusing the existing move/resize handle machinery in `Canvas.tsx`, via a transient→commit gesture). The numeric `{x, y, scale}` and every timing field are **also editable in the properties panel** (R2 defaults confirmed acceptable *as long as they're panel-editable*).
- **R10**: Timing is panel-editable: `startTime`, `transitionIn`, `hold`, `transitionOut`, and `easing`. Deleting a zoom removes it cleanly (the camera resolves to full frame — or the chain re-forms from the neighbours — across its former span).

### UI surface — creating & timing zooms
- **R14 (toolbar re-jig)**: Re-group the header creation controls (`AnnotationTools.tsx`) into labelled clusters: **Assets** (`+ Asset`), **Annotations** (`+ Arrow` / `+ Text` / `+ Pen`), and a **new "Animations" cluster** whose first CTA is **`+ Zoom`**. This cluster is the home for future global/camera animation CTAs (pan, camera-reset, shake, …). Group label naming ("Animations" vs "Camera" vs "Motion") is a minor open call — default "Animations".
- **R15 (create flow)**: `+ Zoom` mirrors how `+ Text` works today (`App.handleCreateObject`, `App.tsx:152`): create with defaults at `playback.globalTime`, select it, put the canvas in Frame view — so the framing rectangle is immediately manipulable.
- **R16 (timeline camera track)**: Zooms render as **bars on a dedicated "Camera" track pinned in the timeline** — *not* one of the object lanes (zooms have no `lane`). Each bar spans the zoom's envelope `[startTime, startTime + transitionIn + hold + transitionOut]`; **drag to retime** (`startTime`, transient→commit like object bars), **resize** to adjust duration, **click to select** (opens its panel + selects its framing rect on canvas). Sub-regions (transition-in / hold / transition-out) use the existing ramp/stripe visual vocabulary (`Timeline.tsx:420-468`). Because chaining is timing-driven (D3), adjacent bars on this one track make an A→B chain visually obvious — which is exactly why the track earns its place over a panel-only list.

### Correctness / non-regression
- **R11**: With no zooms, preview and export are byte-identical to today (the transform collapses to identity).
- **R12**: Camera zooms compose correctly with per-object keyframes/enter-exit (spec 12) and per-object rotation — the camera wraps the whole object loop; per-object transforms nest inside it unchanged.
- **R13**: The camera does not break the video preview rAF blit loop (`useCanvasRenderer.ts:81-90`) or the export frame pump — it's just an extra `save/transform/restore` per frame.

## Technical Considerations

### Proposed types (new, `src/types.ts`)

```ts
// The resolved camera pose at an instant (what renderFrame consumes).
export type CameraState = {
  x: number      // normalized 0–1 focal point, held at canvas center
  y: number      // normalized 0–1
  scale: number  // >= 1 (1 = full frame)
}

// One authored "zoom" — a punch-in envelope. The renderer compiles a list of these
// into a CameraState at each global time. Reuses spec-12 EasingKind.
export type CameraZoom = {
  id: string
  x: number              // focal point (normalized 0–1)
  y: number
  scale: number          // >= 1, the "amount"
  startTime: number      // global seconds — when the ease-in begins
  transitionIn: number   // seconds to ease from the CURRENT camera pose into this target
  hold: number           // seconds held fully zoomed
  transitionOut: number  // seconds to ease back to full frame IF no next zoom takes over first
  easing: EasingKind     // spec-12 curve applied to both in and out ramps
}
// Chaining (A->B) is expressed by TIMING: if zoom B's startTime lands while zoom A is still
// active (holding, or mid ease-out), B's transitionIn eases from A's current pose straight to B's
// target — the camera never returns to full frame between them. Leave a gap and the camera pulls
// back to full frame (via A's transitionOut) before B begins.

export const IDENTITY_CAMERA: CameraState = { x: 0.5, y: 0.5, scale: 1 }
```

`Project` (`types.ts:128-136`) gains one optional field:

```ts
  zooms?: CameraZoom[]
```

New `ProjectAction` cases mirror the existing object CRUD + transient/commit pattern (`types.ts:144-156`):
`ADD_ZOOM` / `UPDATE_ZOOM` / `UPDATE_ZOOM_TRANSIENT` (+ reuse existing `COMMIT_TRANSIENT`) / `REMOVE_ZOOM`. Every non-transient dispatch = one undo entry; dragging the framing rectangle uses the transient→commit protocol (one undo per gesture), exactly like object drag.

### Resolving the camera (`src/lib/camera.ts`, new)

```ts
export function resolveCamera(zooms: CameraZoom[] | undefined, globalTime: number): CameraState
```

**Governing-window model (supports A→B chaining).** Zooms are kept **sorted by `startTime`**. Each zoom *governs* the window `[startTime_i, startTime_{i+1})` (the last zoom governs to project end). Within its window a zoom plays **ease-in → hold → ease-out**, but the ease-in starts from **`fromPose_i` = the resolved camera pose at `startTime_i`**, and the ease-out only completes if the window is long enough:

- `fromPose_i = resolveCamera(zooms[0..i-1], startTime_i)` — i.e. wherever the timeline already put the camera at this zoom's start. If the previous zoom had returned to full frame (a gap), that's `IDENTITY_CAMERA`; if the previous zoom was still held/zoomed (adjacent), it's the previous target → **the camera moves straight A→B without pulling out.**
- within `transitionIn` → `lerp(fromPose_i, target_i, ease(easing_i, u))`.
- within `hold` → `target_i`.
- within `transitionOut` (only reached if `startTime_{i+1}` hasn't arrived) → `lerp(target_i, IDENTITY_CAMERA, ease(easing_i, u))`.
- after `transitionOut` completes and before the next zoom → `IDENTITY_CAMERA`.
- Because `fromPose_i` only depends on **earlier** zooms, a single left-to-right pass resolves it; no cross-references or blending of two simultaneous zooms are needed (windows are half-open and non-overlapping by construction).

Lerp is a plain 3-component `{x,y,scale}` interpolation reusing `lerp` from `easing.ts`. The editor keeps `zooms` ordered by `startTime`; overlap is naturally handled — a later `startTime` simply ends the previous zoom's window early and chains from its current pose.

### The transform (in `renderFrame`, `src/lib/renderer.ts`)

Add an optional camera param so the same function serves Frame view (omit → identity → unchanged output), Live view, and export (pass the resolved camera):

```ts
// signature gains: camera?: CameraState
const cam = camera ?? IDENTITY_CAMERA
ctx.fillStyle = '#000000'; ctx.fillRect(0,0,w,h)   // background stays un-zoomed (letterbox stays black)
ctx.save()
if (cam.scale !== 1 || cam.x !== 0.5 || cam.y !== 0.5) {
  ctx.translate(w/2, h/2)
  ctx.scale(cam.scale, cam.scale)
  ctx.translate(-cam.x * w, -cam.y * h)
}
// ...existing visible-object loop (renderer.ts:43-69) unchanged...
ctx.restore()
```

Nesting is safe: per-object rotation already does its own `save/restore` inside `drawObject` (`renderer.ts:95-145`). When `camera` is absent/identity the block is a no-op → R3/R11 hold.

**Who passes the camera:**
- **Export** (`ffmpegExport.ts` / worker): always passes `resolveCamera(project.zooms, t)`.
- **Preview** (`useCanvasRenderer.ts:45`): passes `resolveCamera(...)` only in **Live view**; in **Frame view** passes nothing (identity). Thread a `camera?: CameraState` (or a `cameraView: 'frame'|'live'`) param from `Canvas` → `useCanvasRenderer`.

### The framing rectangle + grey scrim (`Canvas.tsx` overlay)

The framed region for a camera pose, in normalized coords, is the rect that maps onto the full canvas under the transform:

```
halfW = 0.5 / cam.scale ;  halfH = 0.5 / cam.scale
rect = { x: cam.x - halfW, y: cam.y - halfH, w: 1/cam.scale, h: 1/cam.scale }   // ×canvasW/H for pixels
```

(At `scale = 1` this is the whole canvas — good sanity check.) In Frame view `drawOverlay` (`Canvas.tsx:407`):
1. Compute `cam = resolveCamera(zooms, globalTime)`; derive the pixel rect.
2. Fill the canvas with a translucent grey scrim, then punch out / stroke the rect (draw four dim rects around it, or `evenodd` fill) so the framed region reads bright and the rest is dimmed.
3. Stroke the framing rectangle in an accent color; when a zoom is *selected*, draw the existing move/resize handles on it so it's draggable (reuse `HANDLE_SIZE`/`hitTestHandles`, adapted to operate on the zoom rect instead of an object bbox).

Object selection handles and the camera framing rect are mutually exclusive contexts (you're either editing an object or a zoom), so they don't collide.

### Selection model — objects vs. zooms (new state)

Zooms are **not** `TimelineObject`s (no `lane`/`data`/`keyframes`), so they can't ride the existing `selectedObjectId: string | null` (`App.tsx:27`). Add a parallel selection with the invariant that **at most one of the two is active**:

- Simplest: add `selectedZoomId: string | null` alongside `selectedObjectId`; selecting a zoom clears the object selection and vice versa. (A unified `selection: {kind:'object'|'zoom', id} | null` is cleaner but touches more call-sites — decide at `/task` time.)
- **`PropertiesPanel`** (`App.tsx:356`, takes `object`): when a zoom is selected, render a **Camera/Zoom editor** (numeric `{x,y,scale}` + `startTime`/`transitionIn`/`hold`/`transitionOut` + easing dropdown + Delete) in the same slot instead of the object editor. Reuse the existing `<Section>`/`<Field>`/`<NumberInput>` helpers.
- **`Canvas`** needs `selectedZoom`, the `cameraView` (`'frame'|'live'`), and a zoom dispatch path: framing-rect move/resize writes `{x,y,scale}` via `UPDATE_ZOOM_TRANSIENT` → `COMMIT_TRANSIENT` (exactly like object drag). Object editing is suppressed while a zoom is selected and while in Live view (R6).
- **`Timeline`** (R16) needs the zoom list, `selectedZoomId`, `onSelectZoom`, and zoom dispatch (retime/resize) — the Camera track is a sibling of the object-lane block, rendered from `project.zooms` rather than `objects`.

### Existing types (verbatim, `src/types.ts:128-136`)

```ts
export type Project = {
  id: string; name: string; fps: number; width: number; height: number
  objects: TimelineObject[]; assets: AssetMeta[]
}
```

### Files touched
- `src/types.ts` — `CameraState`, `CameraZoom`, `IDENTITY_CAMERA`, `Project.zooms?`, zoom `ProjectAction`s.
- `src/lib/camera.ts` (new) — `resolveCamera`, rect helpers; reuses `ease`/`lerp` from `easing.ts`.
- `src/lib/renderer.ts` — optional `camera` param + the transform wrap (the only render change; export inherits it).
- `src/hooks/useProject.ts` — zoom reducer cases (`ADD_ZOOM`/`UPDATE_ZOOM`/`UPDATE_ZOOM_TRANSIENT`/`REMOVE_ZOOM` + reuse `COMMIT_TRANSIENT`).
- `src/hooks/useCanvasRenderer.ts` — accept + pass `camera` through to `renderFrame`; add to render deps so paused redraws pick up zoom edits.
- `src/components/App.tsx` — `selectedZoomId` state (+ object/zoom mutual exclusion), the `+ Zoom` create handler (default zoom at playhead → select → Frame view), `cameraView` state, thread zoom props into Canvas/Timeline/PropertiesPanel.
- `src/components/AnnotationTools.tsx` — re-group into **Assets / Annotations / Animations** clusters; add the `+ Zoom` CTA (R14).
- `src/components/Canvas.tsx` — Frame/Live toggle, framing-rect + scrim drawing, selected-zoom framing-rect drag/resize via transient/commit, suppress object editing under a selected zoom / Live view.
- `src/components/Timeline.tsx` — dedicated pinned **Camera track** rendering `project.zooms` as draggable/resizable envelope bars (R16).
- `src/components/PropertiesPanel.tsx` — a Camera/Zoom editor rendered when a zoom is selected (`{x,y,scale}` + timing + easing + delete), reusing existing panel helpers.
- `src/lib/ffmpegExport.ts` (+ export worker) — pass `resolveCamera(project.zooms, t)` per frame.

## Related Systems and Tasks

- **Builds on `TASKS/12-keyframe-easing-engine.md` (done).** Reuses `ease`/`lerp`/`clamp01` from `src/lib/easing.ts`. Does **not** reuse the whole-pose `Keyframe[]` model (`keyframes.ts`) — the camera has its own simpler `CameraZoom` segment model.
- `src/lib/renderer.ts` — the shared preview/export compositor (the transform site).
- `src/components/Canvas.tsx` — overlay canvas + coordinate mapping + hit-testing (framing rect + scrim + draw-to-create live here).
- `src/lib/ffmpegExport.ts`, `videoDecoder.ts` — export path; the camera must not disturb the frame pump.
- `SPECS/14-video-sequencing.md`, `SPECS/15-audio-polish.md` — independent; no interaction expected.

## Resolved decisions (user, 2026-07-09)

- **D1 — Preview model: Frame view + Live toggle.** Default **Frame view** (un-zoomed, full scene + grey-scrim framing rectangle) for authoring; a one-key **Live** toggle applies the real transform for WYSIWYG confirmation; export is always Live. Live-zoom-while-editing is out for v1 (so no inverse-transform hit-testing needed).
- **D2 — Discrete zooms**, not raw camera keyframes. Ship the `CameraZoom` segment model (point + amount + timing). Free-form multi-waypoint camera paths are a possible later layer.
- **D3 — Chaining (A→B) supported.** The camera can move directly from one zoom to the next without returning to full frame, via the governing-window / `fromPose` resolver above (chaining is expressed by adjacency in time). This is why `resolveCamera` eases in from the current pose rather than always from full frame.
- **D4 — Zooms live on a dedicated pinned "Camera" track in the timeline** (items on the main global scrubber, R16), plus a per-zoom editor in the properties panel. Creation is a **`+ Zoom` CTA** in a new **"Animations" cluster** in the header toolbar (R14).
- **D5 — Default zoom params are acceptable** as long as every field is panel-editable (R9/R10). Exact default values still to confirm (Open Q1).

## Open Questions

1. **Default zoom parameter values.** Confirm the numbers for a freshly-created zoom: `scale` (2×?), `transitionIn` (~0.6s), `hold` (~2s), `transitionOut` (~0.6s), `easing` (`easeInOutCubic`). *(Recommended as listed.)*
2. **"Animations" cluster label** — "Animations" vs "Camera" vs "Motion" for the new toolbar group. *(Recommended: "Animations" as the umbrella, since future non-camera global CTAs could live there too.)*
3. **Retiming & overlap UX.** With chaining, dragging one zoom's `startTime` past another changes who chains from whom. Auto-reorder by `startTime` and let visuals update, or hard-prevent overlaps? *(Recommended: keep sorted by `startTime`, allow adjacency, resolver handles it — no hard blocking.)*
4. **Do strokes/fonts scale with zoom in Live view?** A real camera scales everything together. Live view hides editing handles (R6/D1), so this only affects strokes/fonts — which we *want* scaled. *(Recommended: yes, everything scales; no special-casing.)*
5. **Zoom-out / pan beyond the frame.** `scale < 1` (letterbox around the frame) excluded from v1. Confirm not needed soon. *(Recommended: exclude; `scale ≥ 1` only.)*

## Acceptance Criteria

- With no zooms, preview and export render pixel-identically to today (R3/R11).
- Drawing a rectangle in Frame view creates a zoom; in Frame view the framing rectangle + grey scrim animate (glide + tighten) across the zoom's envelope as the playhead moves.
- Toggling to Live view shows the *actual* eased push-in; the exported MP4 shows the identical move (preview==export).
- A zoom's framing rectangle can be moved/resized on the canvas and its timing edited in the panel; deleting it returns the camera to full frame across that span.
- Camera zooms compose correctly with per-object keyframes/enter-exit and per-object rotation (spec 12).

## Implementation Notes

Phased so each step is independently verifiable (`npx tsc -b` green between each; hand the user a "click X / look for Y" checklist per the verify skill — no dev-server/browser automation from Claude):

1. **Types + resolver + static transform.** Add `CameraState`/`CameraZoom`/`IDENTITY_CAMERA` + `Project.zooms?`; write `src/lib/camera.ts` `resolveCamera` (governing-window + `fromPose` chaining — unit-checkable in isolation: gap→full-frame vs adjacent→chain); add the optional `camera` param + transform wrap in `renderFrame`. Prove a **hardcoded** zoom pushes in identically in Live preview and export before any UI. Confirm no-zoom output is unchanged.
2. **Reducer + create flow + panel editor.** Zoom `ProjectAction`s in `useProject.ts`; `selectedZoomId` state + the `+ Zoom` CTA (new "Animations" toolbar cluster in `AnnotationTools.tsx`, wired in `App.tsx` like `+ Text`); a panel editor for the selected zoom (`{x,y,scale}` + timing + easing + delete). Drive the transform from real project data.
3. **Frame view overlay + Live toggle.** Framing rectangle + grey scrim in `drawOverlay`; the Frame/Live toggle (`cameraView`); thread `camera` through `useCanvasRenderer`.
4. **On-canvas authoring.** Select + move/resize the selected zoom's framing rect via transient→commit (reuse handle machinery, dispatch `UPDATE_ZOOM_TRANSIENT`); optional draw-rectangle-to-create (aspect-fit → `{x,y,scale}`).
5. **Timeline Camera track.** Pinned Camera track in `Timeline.tsx` rendering `project.zooms` as envelope bars; drag-to-retime + resize (transient→commit) + click-to-select. This is where chaining becomes visible (D3/D4) — not an optional fast-follow.
6. **Export wiring.** Pass `resolveCamera(project.zooms, t)` per frame in `ffmpegExport.ts` (+ worker); confirm a real exported push-in matches Live preview.

---
*Draft rewritten 2026-07-09 around discrete "zooms" + Frame/Live views + A→B chaining + a timeline Camera track + an "Animations" toolbar cluster (decisions D1–D5 locked with the user). Remaining Open Questions are minor (default values, group label, overlap UX) and all have recommendations — this spec is close to `/task 13`-ready.*
