# 18-qol — editor quality-of-life batch

## Overview

A batch of unrelated editor quality-of-life papercuts. The first two (R1, R2) are canvas
**overlay/chrome** fixes in [Canvas.tsx](src/components/Canvas.tsx) — the render pipeline and
exported video are unaffected. The last three (R3–R5) were added in a later spec pass and touch
persistence, the left rail, and text rendering respectively.

1. **Out-of-frame resize handles are unreachable.** When an object's bounding box extends
   beyond the frame (the object is bigger than the canvas), its resize/rotate handles fall
   outside the frame and are invisible + un-grabbable — so you can't shrink an oversized
   object by dragging a corner. Reference: Canva keeps the handles visible in the pasteboard
   margin around the artboard (user-supplied screenshots: ours clips the handles, Canva shows them).

2. **Floating context toolbar can leave the screen for tall selections.** The
   `ContextToolbar` anchors above the selection and flips below when there's no room above.
   For an object taller than the frame, *neither* above nor below fits inside the viewport,
   and the current logic flips it below the object's bottom edge — pushing the bar off the
   bottom of the visible area (user screenshot 3). It must stay fully on-screen.

3. **Aspect ratio isn't remembered across projects.** Changing the canvas size/aspect ratio
   applies only to the current project; because the app boots to a fresh `createDefaultProject()`
   (1920×1080) each time (`persistProject: false`), the next project always reverts to 16:9. The
   chosen canvas size should be remembered and become the default for the next new project.

4. **The creation-category selector has a weak "you are here" indicator.** In the `LeftRail`, the
   active section is only marked by the accent text color + a thin 0.5px accent bar on the icon;
   there's no visual link between the selected icon and the content pane showing its sub-options,
   so the two read as "two rectangles." Add a clearer indicator (e.g. a caret/triangle pointing
   from the active icon into the pane) that ties the category to its options.

5. **Text objects can't have rounded corners.** A text object's optional background is drawn as a
   hard-cornered `fillRect`. Add an option to give text objects rounded corners.

6. **Text can only be edited from the side panel.** To change a text object's content you have to find
   its `content` field in the right-hand `PropertiesPanel`. There's no way to edit text *in place* on
   the canvas (double-click to type), which is the expected editor interaction and much less confusing.

7. **Right-hand property sections start expanded.** Every `Accordion` in `PropertiesPanel` defaults
   open (`useState(true)`), so selecting an object dumps a tall wall of open sections. They should
   start **collapsed** so the panel is scannable and you open only what you need.

R1/R2 are fixes to `Canvas.tsx`'s overlay geometry and the toolbar-anchoring `useLayoutEffect`.
R3–R7 are independent and are specified in their own sections below.

> **Split out:** *text objects with special / animated effects* (glow, neon, gradient, animated
> presets; fire deferred) was raised alongside these items and is now its own spec —
> **[19-text-effects](19-text-effects.md)** (Tier 1 static + Tier 2 animated first). Not part of this
> batch.

## Requirements

### R1 — Handles remain visible & grabbable when the object exceeds the frame
- R1.1 When a selected object's bbox (and its resize handles / rotation handle) extends past
  any frame edge, the selection box, the eight resize handles, and the rotation handle must
  still **render** (in the margin around the frame), not be clipped at the frame edge.
- R1.2 Those out-of-frame handles must be **clickable** — a mousedown in the margin over a
  handle must start the corresponding resize/rotate drag, exactly as an in-frame handle does.
- R1.3 The fix must not alter the rendered frame, export, or the in-frame case (an object that
  fits sees pixel-identical overlay chrome to today).
- R1.4 Hit-testing must stay correct: a handle drawn at normalized `x < 0` or `x > 1` grabs at
  that same out-of-frame position; the resize math (`computeResize`) is already
  frame-normalized and must be reused unchanged.
- R1.5 Interop with the existing editor viewport zoom/pan (spec 16 C): the bleed overlay must
  stay pixel-aligned with the render canvas at every `scale`/`pan`, and zooming out must now
  reveal *more* of the out-of-frame handles (today it reveals more black margin but the
  clipped overlay still hides them).

### R2 — Floating toolbar always stays within the visible viewport
- R2.1 The `ContextToolbar` / `ZoomContextToolbar` must never render partially or fully outside
  the visible render area, for any selection size or position — including an object taller
  and/or wider than the frame.
- R2.2 Preferred placement order stays: **above** the selection → **below** if no room above.
  New: when the selection is too tall for either to fit inside the viewport, the bar **pins to
  the top edge** of the viewport (overlapping the selection's upper area) rather than
  overflowing off-screen. *(Decision: top, not bottom — keeps it clear of the transport/timeline.)*
- R2.3 The bar's final resolved position must be clamped on **both** axes to the visible area
  (today only the horizontal `left` is clamped, and only to the frame, not the viewport).
- R2.4 No regression to the common case (small selection, plenty of room): the bar sits
  centered above the selection exactly as today.

### R3 — Remember the canvas size for the next new project
- R3.1 When the user changes the project dimensions (via `AspectRatioSelector` → `SET_DIMENSIONS`,
  preset **or** custom), the chosen `{width, height}` is written to a persistent store (localStorage),
  independent of `config.persistProject`.
- R3.2 On boot, a **new/default** project is created with those remembered dimensions instead of the
  hard-coded 1920×1080. If nothing was ever remembered (or the stored value is invalid), fall back to
  1920×1080.
- R3.3 This must hold with `persistProject: false` (the default) — i.e. even though the *project*
  itself isn't persisted, the *canvas size preference* is. (When `persistProject: true`, the loaded
  project already carries its own dims; the remembered preference only seeds fresh/default projects.)
- R3.4 The remembered value is a **preference**, not project data: it is not part of the project JSON,
  not part of undo/redo, and not included in `.brep` export/import.
- R3.5 Persistence must degrade gracefully when localStorage is unavailable (private mode / quota) —
  the app still works, just without the memory (mirror `useUiPrefs`' try/catch).

### R4 — Clearer active-category indicator in the LeftRail
- R4.1 The active section in the icon rail must have a visually stronger "selected" treatment than the
  current thin bar — at minimum a caret/triangle (or equivalent connector) that visually points from
  the active icon toward the content pane.
- R4.2 The connection between the selected icon and the content pane (its sub-options) must read as a
  single grouped unit — e.g. the caret sits on the seam between the rail and the pane, and/or the
  active icon shares a background/surface with the pane.
- R4.3 Only the active section shows the indicator; switching sections moves it. Collapsing the pane
  (clicking the active icon again) hides the pane; the indicator should not point at a closed pane.
- R4.4 Pure presentation change: no change to which sections exist, what they create, or the
  create/collapse behavior in [LeftRail.tsx](src/components/LeftRail.tsx).

### R5 — Rounded corners for text objects
- R5.1 A text object gains an optional **corner radius** that rounds the corners of its background
  panel. (Resolved OQ7: panel corners only — no separate stroke/outline border.)
- R5.2 The radius is authored in the text properties (a numeric input/slider near the existing
  Background control), persists in the object's `data`, and is part of undo/redo.
- R5.3 The rounded corners render identically in **preview and export** (both go through
  `drawText` in `renderer.ts`/`annotations.ts` — one code path).
- R5.4 Backwards compatible: existing text objects (no radius field) render exactly as today
  (square corners); radius `0`/undefined ⇒ current `fillRect` behavior.
- R5.5 The radius scales with the object/box like `padding` does (via `scaleFactor`), and is clamped
  so it can't exceed half the smaller box dimension (no rendering artifacts).

### R6 — In-place (on-canvas) text editing
- R6.1 Double-clicking a text object on the canvas (Frame view, move mode) enters an **edit mode**: an
  editable field appears positioned over the object's on-screen box, focused, with the current text
  selected/caret-ready.
- R6.2 Typing updates the object's `TextData.content`; the change is reflected live and lands in
  undo/redo as **one** entry per edit session (open → type → commit), not one per keystroke — reuse the
  transient→commit pattern (`UPDATE_OBJECT_TRANSIENT` while typing → `COMMIT_TRANSIENT` on finish), or a
  single `UPDATE_OBJECT` on commit.
- R6.3 Commit on **blur** or **Escape**/**⌘/Ctrl+Enter**; a plain **Enter inserts a newline** (text
  boxes are multi-line). Escape may either commit or cancel — pick one and be consistent (see OQ9).
- R6.4 While editing: canvas drag/resize/rotate and keyboard shortcuts (Delete, arrows, etc.) are
  suppressed so typing doesn't move/delete the object; the rendered text underneath is hidden (or
  visually replaced by the edit field) to avoid a double image.
- R6.5 The edit field is positioned/sized to the object's box in **client space**, tracking the editor
  viewport zoom/pan and (at minimum best-effort) rotation, so it sits over the object. Exact WYSIWYG
  font matching is *not* required for v1 — approximate font/size/alignment is acceptable; the canonical
  render still comes from `drawText` on commit.
- R6.6 Creating a new text object may optionally drop straight into edit mode (nice-to-have, OQ10).
- R6.7 No export/render-pipeline change: editing only writes `content`; `renderFrame`/`drawText` are
  untouched. Preview and export are unaffected.

### R7 — Property sections start collapsed
- R7.1 Every `Accordion` in `PropertiesPanel` (object editor and `ZoomEditor`) starts **collapsed**.
- R7.2 The user can still expand any section; expand/collapse state is per-session view state (no
  persistence required).
- R7.3 No change to which sections exist or their contents — only the initial open state.

> **R8 — moved.** Text special effects now live in **[19-text-effects](19-text-effects.md)** (own spec:
> Tier 1 static glow/outline/shadow/gradient + Tier 2 animated pulse/rainbow/wave/shimmer; fire
> deferred). Not implemented as part of this batch.

## Technical Considerations

### Relevant types (all already defined — no new types required for the core fix)

`TimelineObject` — [src/types.ts:5-40](src/types.ts#L5-L40). The coordinates that make an
object "bigger than the frame":
```ts
// normalised 0–1, multiplied by project width/height at draw time
x: number; y: number; width: number; height: number
rotation: number // radians about the bbox center
```
Nothing clamps these to `[0,1]` — `computeResize`/move only enforce `MIN_SIZE` (0.01) and
never a frame bound ([Canvas.tsx:294-302](src/components/Canvas.tsx#L294-L302)), so objects
freely extend past the frame. That is intended (matches the pasteboard model); the bug is
purely that the overlay can't *show/grab* the handles out there.

Local types in [Canvas.tsx](src/components/Canvas.tsx) that the fixes touch:
```ts
type HandleId = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'            // :35
type ViewportState = { scale: number; panX: number; panY: number } // :19 (editor zoom/pan)
type DragState = … | { kind:'resize'; handle:HandleId; … } | { kind:'rotate'; … } // :38-88
// toolbar anchor state (:1261)
const [toolbarPos, setToolbarPos] =
  useState<{ left: number; top: number; side: 'above' | 'below' } | null>(null)
```
`ContextToolbar` props — [ContextToolbar.tsx:24-34](src/components/ContextToolbar.tsx#L24-L34)
(`object`, `dispatch`, `globalTime`, `onToggleDraw?`); `ZoomContextToolbar` props —
[ContextToolbar.tsx:88-98](src/components/ContextToolbar.tsx#L88-L98). Neither needs to change
for R2 — R2 is entirely in the anchoring `useLayoutEffect`
([Canvas.tsx:1287-1343](src/components/Canvas.tsx#L1287-L1343)).

### Why the handles are clipped today (R1 root cause)

The overlay is a **second canvas** stacked on the render canvas, sized to the frame exactly:
```tsx
// backing store = frame dims (Canvas.tsx:559-564)
oc.width = width; oc.height = height
// element = fit box exactly (Canvas.tsx:1356-1359)
<canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full" … />
```
A canvas **clips its own drawing to its backing store**, and the DOM element only receives
mouse events within its own box. So:
- `drawOverlay` draws a handle at frame-px `(obj.x*width, …)`; when `obj.x < 0` that's outside
  `[0,width]` and is **not painted** ([Canvas.tsx:764-782](src/components/Canvas.tsx#L764-L782)).
- Even if it were painted, `handleMouseDown` never fires for a click in the margin, because the
  overlay element ends at the frame edge — the click lands on the render area, not the overlay.
- `clientToNorm` divides by the overlay rect ([Canvas.tsx:121-130](src/components/Canvas.tsx#L121-L130)),
  which equals the frame, so it can't express margin coordinates as clicks anyway.

Note the editor already supports objects extending past the frame during a *drag* (the
window-level `mousemove` at [Canvas.tsx:1118-1182](src/components/Canvas.tsx#L1118-L1182) uses
`clientToNorm` and works outside the canvas). The only gap is the initial *grab* + the *paint*
of out-of-frame handles. Both are solved by giving the overlay a bleed margin.

### Recommended approach for R1 — bleed overlay

Give the **overlay canvas** (only) a symmetric bleed margin of fraction `M` of each axis, so
it spans normalized `[-M, 1+M]` in both x and y. The **render canvas stays frame-sized and
frame-only** (export/preview untouched — confirmed it's sized `width×height` in
[useCanvasRenderer.ts:59-62](src/hooks/useCanvasRenderer.ts#L59-L62)). Concretely:

1. **Overlay backing store** → `(1+2M)*width × (1+2M)*height` (update the effect at
   [Canvas.tsx:559-564](src/components/Canvas.tsx#L559-L564); key it on `M` too).
2. **Overlay element CSS** → offset out and grown, with the transform pivot kept on the frame
   origin so it scales/pans in lockstep with the render canvas:
   ```
   left: -M*100%              top: -M*100%
   width: (1+2M)*100%         height: (1+2M)*100%
   transform: <same viewportTransform as render canvas>
   transform-origin: (M/(1+2M))*100%  (M/(1+2M))*100%   // = the frame's top-left, in overlay-local space
   ```
   (Render canvas keeps `transform-origin: 0 0`. Both pivot about the same physical point =
   frame top-left, so the overlay's inner frame region stays exactly over the render canvas at
   every zoom/pan. Verified: translate is origin-independent; equal scale about a coincident
   pivot keeps them locked.)
3. **`drawOverlay`** → after `clearRect(0,0, (1+2M)*width, (1+2M)*height)`, apply a one-line
   `ctx.setTransform(1,0,0,1, M*width, M*height)` (translate the drawing origin to the frame
   origin). **Every existing frame-px drawing line then stays byte-for-byte unchanged** and
   simply lands at the right place, with out-of-frame handles now inside the enlarged backing
   store. This is the key to keeping the blast radius tiny.
4. **`clientToNorm`** → normalize against the **render canvas** rect (the frame), not the
   overlay rect, so `nx,ny` stay in frame-normalized space (negative / >1 in the margin). All
   existing hit-test math consumes frame-normalized coords and needs **no change** — a handle
   at `nx<0` hit-tests correctly. (Pass the render-canvas ref, or its `getBoundingClientRect()`,
   into `clientToNorm`.)
5. **Toolbar anchor** → the `useLayoutEffect` currently derives the frame→client scale from
   `overlay.getBoundingClientRect()` ([Canvas.tsx:1321-1327](src/components/Canvas.tsx#L1321-L1327));
   switch that to the **render canvas** rect so the enlarged overlay doesn't skew it.

Blast radius: overlay-sizing effect, overlay JSX, one `setTransform` in `drawOverlay`,
`clientToNorm`'s reference rect, and the toolbar-anchor scale source. The render canvas, the
renderer, the resize/rotate math, and every `draw*` call are untouched.

**Trade-offs / knobs:**
- **How much bleed (`M`)?** Bigger `M` = more out-of-frame chrome visible before the render
  area's `overflow-hidden` clips it, but a larger overlay backing store cleared+redrawn each
  playback frame (`(1+2M)²`× the pixels; e.g. `M=0.5` ⇒ 4×). The overlay only strokes a few
  shapes, so the cost is the `clearRect`. Recommend a moderate fixed `M` (≈0.35–0.5) — enough
  for corner handles + the 30px rotation handle — rather than dynamic resizing (which would
  clear/flicker the canvas whenever it changes).
- **Render-area clip.** The render area is `overflow-hidden` with `p-4 pb-20`
  ([Canvas.tsx:1346](src/components/Canvas.tsx#L1346)) — only ~16px of guaranteed top/side
  margin at 100% "Fit", 80px at the bottom. So at Fit, an object flush to the frame top may
  still clip its rotation handle. Mitigation: the **existing zoom-out now helps** (bleed +
  zoom-out reveals the handles, which it couldn't before). Optionally bump the top/side padding
  for more guaranteed room. Full pasteboard-style "always lots of margin" is out of scope.

**Alternatives considered:**
- *Clamp handles to the frame edge* (draw them just inside when they'd be outside). Rejected:
  the user explicitly wants Canva behavior (handles in the margin at their true position); a
  clamped handle sits at the wrong place and overlaps the object.
- *Render handles as non-clipped DOM/SVG* instead of canvas. Rejected: `drawOverlay` also
  paints the arrow rubber-band and the camera scrim punch-out on the same canvas; splitting the
  chrome across two rendering models is a large rewrite for a QoL fix.

### Recommended approach for R2 — clamp the toolbar into the viewport

Today the anchor effect ([Canvas.tsx:1287-1343](src/components/Canvas.tsx#L1287-L1343)):
- computes the selection `bounds` (rotated bbox + rotate-handle tip + handle pad) in project px,
- converts to fit-box-local px,
- picks `side` = `'above'` unless `topLocal - MARGIN - barH < PAD`, else `'below'`
  ([Canvas.tsx:1332](src/components/Canvas.tsx#L1332)),
- clamps only `left` (to the **fit box** width) — **`top` is never clamped**
  ([Canvas.tsx:1333-1336](src/components/Canvas.tsx#L1333-L1336)).

For a taller-than-frame object, `topLocal` is above the viewport (→ flips `'below'`) and
`bottomLocal` is below the viewport, so `top = bottomLocal + MARGIN` lands off-screen.

Fix, inside the same effect:
1. Establish the **visible vertical range** to clamp to. Recommended: the render-area rect
   (uses the `p-4/pb-20` margin, maximizing visible space) converted to fit-box-local via
   `renderAreaRef`/`fitRef` client rects. The fit box (frame) is an acceptable simpler bound.
2. Decide `side` from whether the bar *fits inside that range* above vs below (not just
   relative to `PAD`): `roomAbove = topLocal - MARGIN - barH >= visTop + PAD`;
   `roomBelow = bottomLocal + MARGIN + barH <= visBottom - PAD`.
3. If neither fits (tall selection) → **pin** (recommended: top of the viewport, overlapping
   the selection — matches Canva and avoids colliding with the transport/timeline at the
   bottom).
4. **Clamp the bar's resolved top edge** into `[visTop + PAD, visBottom - barH - PAD]` as a
   final safety net — accounting for the `translateY(-100%)` used when `side==='above'` (in
   that case the styled `top` is the bar's *bottom*, so convert to a top-edge before clamping,
   or clamp then re-derive the styled value).
5. Optionally widen the horizontal clamp from the fit box to the render area for consistency
   (not required by the reported bug).

This is contained entirely in the anchoring `useLayoutEffect`; the toolbar components and their
props don't change. The `translateY` handling in the JSX
([Canvas.tsx:1405-1422](src/components/Canvas.tsx#L1405-L1422)) may need a small tweak if step 4
introduces a third `side` (`'pinned'`); keeping to two sides + a clamp avoids that.

### R3 — canvas-size preference (persistence)

**Current boot path** ([useProject.ts:251-257](src/hooks/useProject.ts#L251-L257)):
```ts
const [state, dispatch] = useReducer(projectReducer, null, () => ({
  past: [], future: [], transientSnapshot: null,
  present: config.persistProject ? loadProject() : createDefaultProject(),
}))
```
`createDefaultProject()` ([types.ts:229-239](src/types.ts#L229-L239)) hard-codes `width: 1920,
height: 1080`. `SET_DIMENSIONS` ([useProject.ts:159-161](src/hooks/useProject.ts#L159-L161)) is the
only dimension mutation and is dispatched solely from `AspectRatioSelector` (preset + custom).

**There is no explicit "New Project" action** — grep confirms no reset/new-project button. So "the
next time you open a new project" == **the next app boot** (refresh) with `persistProject: false`.
(If a New-Project button is later added, it should seed from the same preference — noted in
Implementation Notes.)

**Precedent — `useUiPrefs`** ([useUiPrefs.ts](src/hooks/useUiPrefs.ts)): a `localStorage` prefs blob
(`ui-prefs`) that persists **independently of `config.persistProject` and of undo**, with a
try/catch `load()`/save-effect. R3 mirrors this exactly. Spec 17 established this "prefs blob separate
from the project" pattern.

**Recommended approach:** a tiny persistence helper (e.g. `src/lib/canvasSizePref.ts` — or fold into
a renamed `useUiPrefs`/a new `useCanvasSizePref` hook) exposing:
```ts
type CanvasSize = { width: number; height: number }
function loadCanvasSize(): CanvasSize | null   // parse + validate via sanitizeDimension; null if absent/invalid
function saveCanvasSize(size: CanvasSize): void // try/catch, key e.g. 'canvas-size'
```
Then:
- **Seed on boot:** `createDefaultProject()` gains an optional dims arg — `createDefaultProject(size?:
  CanvasSize)` — and the `useProject` initializer passes `loadCanvasSize() ?? undefined`. (Keeping the
  default arg means every other `createDefaultProject()` caller — `projectStorage.loadProject()`
  fallback, `.brep` import errors — is unchanged and still gets 1920×1080.)
- **Save on change:** either (a) an effect in `useProject`/`App` that writes `saveCanvasSize({width,
  height})` whenever `present.width/height` change, or (b) call `saveCanvasSize` right where
  `SET_DIMENSIONS` is dispatched in `AspectRatioSelector`. **(a) is preferred** — one writer, catches
  dims changing via any path (import, future actions), and keeps the pref logic out of the component.
  Validate with `sanitizeDimension` on **load** (guards against a corrupted/hand-edited blob).

No type changes to `Project`/`ProjectAction`; `CanvasSize` is a new local prefs type. Note the subtle
interaction with `persistProject: true`: `loadProject()` returns the saved project (its own dims);
the size pref only matters for the `createDefaultProject()` branch, so wiring the seed there keeps the
two paths cleanly separate.

### R4 — LeftRail active-category indicator

All in [LeftRail.tsx](src/components/LeftRail.tsx) — a pure JSX/Tailwind change. Structure today:
an icon rail (`w-13`, [:45-70](src/components/LeftRail.tsx#L45-L70)) and a sibling content pane
(`w-52`, [:73-95](src/components/LeftRail.tsx#L73-L95)), both children of a flex row. Active state is
`section === id && open`; today's marker is `text-accent` + `<span className="absolute left-0 top-1
bottom-1 w-0.5 … bg-accent" />` ([:57](src/components/LeftRail.tsx#L57)).

Options (any/combination — this is a visual-design call, see OQ6):
- A right-pointing **caret** on the active icon button, positioned on the rail↔pane seam
  (`absolute right-0`, a CSS triangle via borders or a small rotated square / an `IconCaretRight`).
- Give the active icon button a **filled surface** (e.g. `bg-surface` / `bg-accent-soft`) that matches
  the pane background so icon+pane read as one shape; drop or thicken the existing accent bar.
- A subtle connector/notch bridging the `border-r` between rail and pane at the active row.
The `@tabler/icons-react` set is already imported (`IconChevronRight` is in use) so a chevron/caret
glyph is available with no new dependency. No prop/type changes; `RailSection` and section list stay.

### R5 — rounded text corners

**Type change** — add an optional field to `TextData` ([types.ts:100-107](src/types.ts#L100-L107)):
```ts
export type TextData = {
  content: string
  background?: string
  padding?: number
  align?: TextAlign
  autoSize?: boolean
  cornerRadius?: number   // NEW: px (project-space, pre-scaleFactor) corner radius for the panel; default 0/undefined = square
}
```
**Render** — `drawText` ([annotations.ts:238-326](src/lib/annotations.ts#L238-L326)) draws the
background at [:293-296](src/lib/annotations.ts#L293-L296) via `ctx.fillRect(bx, by, bw, bh)`. Replace
with a rounded path when a radius is set:
```ts
if (data.background) {
  ctx.fillStyle = data.background
  const r = Math.max(0, Math.min((data.cornerRadius ?? 0) * scaleFactor, bw / 2, bh / 2))
  if (r > 0) { ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, r); ctx.fill() }
  else ctx.fillRect(bx, by, bw, bh)
}
```
`CanvasRenderingContext2D.roundRect` is widely supported and already the environment's Canvas 2D API;
if a worker/export-path type lacks it, a small manual arc path is the fallback. `scaleFactor` clamp
mirrors R5.5. **`r=0`/undefined keeps the exact `fillRect` path** (R5.4 back-compat).

**Panel control** — [PropertiesPanel.tsx:470-491](src/components/PropertiesPanel.tsx#L470-L491) has the
Background `Field`. Add a sibling **"Corner radius"** `Field` (number input or slider) wired through the
existing `updateData({ cornerRadius }, { cornerRadius })` helper
([:62](src/components/PropertiesPanel.tsx#L62)), which already handles TextData updates + "remember"
defaults. Reasonable range 0–~100px (project-space), shown only for `obj.type === 'text'`. Resolved
OQ7 = panel corners only, so the control naturally groups with the Background control.

### R6 — in-place text editing

**Where the interaction lives:** [Canvas.tsx](src/components/Canvas.tsx). `handleDoubleClick`
([:1212-1229](src/components/Canvas.tsx#L1212-L1229)) currently only finishes an arrow; extend it to:
if the hit object under the pointer is `type === 'text'` (and Frame view / move mode), set an
`editingTextId` state and stop other handling.

**Positioning the edit field:** the toolbar-anchor effect already converts an object's project-px box
→ **fit-box-local px** through the live overlay rect (which reflects the spec-16 viewport
zoom/pan): [Canvas.tsx:1321-1327](src/components/Canvas.tsx#L1321-L1327)
(`sx = overlayRect.width/width`, `left = overlayRect.left + x*width*sx - fitRect.left`, …). Reuse that
same mapping to place a `<textarea>` (or contenteditable `<div>`) as a **non-transformed sibling in the
fit box** (exactly how the `ContextToolbar` is hosted, [:1256-1261](src/components/Canvas.tsx#L1256-L1261)),
sized to the object's on-screen w×h. Rotation: apply `rotate(obj.rotation)` on the field for
best-effort alignment (v1 can skip perfect rotated-caret fidelity — R6.5).

**State & dispatch:** new `editingTextId: string | null` (ephemeral view state, like `cameraView`).
On each change dispatch `UPDATE_OBJECT_TRANSIENT { data: { ...textData, content } }`; on commit
(blur/Esc/⌘Enter) dispatch `COMMIT_TRANSIENT` → one undo entry (mirrors the drag pattern documented in
CLAUDE.md). Hide the rendered glyphs while editing by either skipping that object in the preview render
or overlaying an opaque field — simplest is to style the textarea with the object's background/color so
it reads as the same block (R6.4).

**Font matching:** `autoSize` text fits font to the box, which a plain textarea can't replicate exactly;
v1 uses an approximate `font-size`/`font-family`/`text-align` from `style`/`data` and accepts minor
mismatch — the authoritative look returns from `drawText` the instant editing ends (R6.5).

**Suppression:** while `editingTextId` is set, early-return from `handleMouseDown`/drag and the
window-level key handlers (Delete/arrows) so typing doesn't mutate the object geometry (R6.4).

No type changes; no renderer changes. This is contained to `Canvas.tsx` state + one JSX field + the
existing transient/commit reducer actions.

### R7 — accordions start collapsed

One-line default flip in the shared `Accordion` component
([PropertiesPanel.tsx:760-776](src/components/PropertiesPanel.tsx#L760-L776)): `useState(true)` →
`useState(false)`. If a few sections should stay open (none required by the ask — user said *all*
closed), add an optional `defaultOpen?: boolean` prop instead and leave callers at the new default.
Note the `ZoomEditor` accordions use the same component, so they collapse too (consistent). State is
local per mount (already ephemeral) — R7.2 needs no extra work.

### R8 — text effects → see [19-text-effects](19-text-effects.md)

Moved to its own spec. The design assessment (the "renderer is a pure fn of `(object, time)`" constraint,
the Tier 1 / Tier 2 / deferred-fire tiering, the `TextEffect` union on `TextData`, and the one real
plumbing cost — threading clip-relative `time` into `drawText`) now lives there. Note the overlap with
R5: both touch `TextData` + `drawText`, and the rounded background draws *before* the glyph effects.

## Related Systems and Tasks

- **Spec 13 (camera zoom)** — the overlay also draws the camera framing rect + grey scrim and
  hosts `ZoomContextToolbar`. R1's bleed overlay must not disturb the scrim (it fills
  `0,0,width,height`; after the `setTransform` translate it still covers the frame — verify the
  scrim still blackens the whole frame and only the frame). R2's clamp already applies to the
  zoom toolbar (shared effect); zoom framing rects are always ≤ frame so they can't be
  "taller than frame," but the clamp is still the correct safety net.
- **Spec 16 C (editor viewport zoom/pan)** — R1 shares the `viewportTransform`; the
  transform-origin math above is the integration point. This is why R1.5 exists.
- **Spec 17 P (floating context toolbar)** — R2 lives in the anchoring code introduced there;
  `TASKS/✅ 17-ui-redesign.md` documents the original anchor design (flip + horizontal clamp).
- `CLAUDE.md` → "Overlay must mirror render transforms" gotcha — R1 keeps that invariant
  (overlay stays transform-locked to the render canvas, just larger).
- **Spec 17 (UI redesign)** — introduced both the `LeftRail` (R4 lives here) and the `useUiPrefs`
  localStorage prefs-blob pattern that R3 mirrors (`TASKS/✅ 17-ui-redesign.md`). R3's canvas-size
  pref is "another prefs blob, separate from the project JSON / persistProject / undo," exactly like
  theme.
- **`AspectRatioSelector` / `src/lib/aspectRatios.ts`** — R3's write point (`SET_DIMENSIONS`) and the
  `sanitizeDimension`/`MIN_DIMENSION`/`MAX_DIMENSION` validators R3 reuses on load.
- **`src/lib/annotations.ts` `drawText`** (shared by preview + export via `renderer.ts`) — R5's single
  render change; `TextData` in `src/types.ts` is R5's only type change.

## Resolved decisions

- **OQ1 (R1) — RESOLVED: handles/box only.** Out-of-frame chrome = the selection box + resize
  handles + rotation handle floating over the black margin. The render canvas stays frame-only;
  the object content stays clipped at the frame edge (no faded pasteboard object). Export is
  frame-only regardless. This keeps the change contained to the overlay canvas.
- **OQ3 (R2) — RESOLVED: pin to top.** When neither above nor below fits inside the viewport,
  the bar pins to the **top** of the visible area, overlapping the selection's upper region.
- **OQ5 — SUPERSEDED.** Originally "scope is exactly these two items." The batch was later extended
  with R3 (canvas-size memory), R4 (LeftRail indicator), and R5 (rounded text corners). Scope is now
  these **five** items.
- **OQ8 (R3) — "new project" == app boot.** There is no explicit New-Project button today, so R3
  applies at the fresh-boot `createDefaultProject()` path. If a New-Project button is added later it
  seeds from the same pref. Custom (non-preset) dims are remembered too (full `{width,height}`, not
  just a preset id).

## Open Questions (minor — tuning knobs, non-blocking)

- **OQ2 (R1) — bleed amount `M`.** Defaulted to a moderate fixed fraction (≈0.4, enough for
  corner + rotation handles) with the existing zoom-out covering extreme cases. Finalize the
  exact value during implementation; optionally increase the render area's top/side padding for
  more guaranteed margin at 100% "Fit". Not blocking.
- **OQ4 (R2) — clamp bound.** Defaulted to the **render area** (viewport) so the bar uses the
  `p-4/pb-20` margin and stays off the selection where possible; the fit box (frame) is an
  acceptable simpler fallback. Finalize during implementation. Not blocking.
- **OQ6 (R4) — visual treatment.** The exact indicator (caret only vs caret + shared surface vs
  connector notch) is a design call; the user suggested a triangle. Pin the concrete style during
  implementation. Not blocking on architecture (all pure JSX/Tailwind).
- **OQ9 (R6) — Escape = commit or cancel?** Default: **Esc commits** (blur also commits); a cancel/revert
  needs snapshotting the pre-edit content. Pick during implementation; not blocking.
- **OQ10 (R6) — new text object drops into edit mode?** Nice-to-have; default **yes** (create → focus
  edit field) since it matches Canva/Figma. Not blocking.
- ~~**OQ11 (R8) — home & first tier.**~~ **RESOLVED: own spec** → [19-text-effects](19-text-effects.md),
  Tier 1 static + Tier 2 animated first, fire deferred. Removed from this batch.
- ~~**OQ7 (R5) — "rounded borders": panel corners only, or an actual stroke border too?**~~
  **RESOLVED: panel corners only (reading (a)).** Round the corners of the existing **background
  panel** via `roundRect` on the fill — a single `cornerRadius` field, no stroke/outline. No
  `borderColor`/`borderWidth` fields. The radius therefore has no visible effect when no background is
  set (the "Corner radius" control can be grouped with / gated behind the Background control in the
  panel). A drawn outline border remains a possible follow-up.

## Acceptance Criteria

- **AC1 (R1):** Add an object (e.g. a rectangle/photo), resize it larger than the frame so its
  edges spill past all four sides. All eight resize handles + the rotation handle are visible in
  the margin, and dragging any of them resizes/rotates correctly. Shrinking it back down works.
- **AC2 (R1):** An object that fits inside the frame shows identical selection chrome to before
  (visual no-op), and export output is unchanged.
- **AC3 (R1 × spec 16):** With an oversized object selected, zoom the editor viewport out — more
  of the out-of-frame handles become visible; pan keeps overlay + render canvas perfectly
  aligned (no drift of the selection box off the object).
- **AC4 (R2):** Select an object taller than the frame (top above the frame, bottom below it).
  The floating toolbar stays fully on-screen (pinned inside the viewport), not cut off at the
  bottom as in screenshot 3.
- **AC5 (R2):** Normal-sized selections still show the bar centered above (or flipped below near
  the top edge) exactly as today; the bar never overlaps the panels or leaves the render area.
- **AC7 (R3):** Change the canvas size to e.g. 9:16 (or a custom size), refresh the app (default
  `persistProject: false`) — the new/default project opens at the remembered size, not 1920×1080.
  Clearing localStorage (or first-ever load) opens at 1920×1080. `.brep` export/import and undo are
  unaffected by the pref.
- **AC8 (R4):** Select each LeftRail category — the active icon shows the caret/connector pointing at
  the content pane, and the icon+pane read as one grouped unit; switching categories moves the
  indicator; collapsing the pane hides it. Nothing about what each category creates changes.
- **AC9 (R5):** Add a text object, enable a background, set a corner radius — the panel renders with
  rounded corners identically in preview and in exported MP4. Radius 0 (or an old text object with no
  radius) renders square exactly as before. Radius is undoable.
- **AC10 (R6):** Double-click a text object on the canvas → an editable field appears over it, focused;
  type to change the text and it updates live; click away/Esc commits as a single undo step; the object
  doesn't move or get deleted while typing; at 100% and while zoomed/panned the field stays over the
  object. Export is unaffected.
- **AC11 (R7):** Selecting any object shows all right-hand property sections collapsed; expanding a
  section works; the same holds for a selected camera zoom's editor.
- **AC6:** `npx tsc -b` stays green.

*(Text effects acceptance criteria moved to [19-text-effects](19-text-effects.md).)*

## Implementation Notes

- Everything is in [src/components/Canvas.tsx](src/components/Canvas.tsx). No changes to
  `renderer.ts`, `useCanvasRenderer.ts`, `ContextToolbar.tsx`, types, or the reducer are
  required for the core fix.
- **R1 touch points:** overlay-sizing effect
  ([:559-564](src/components/Canvas.tsx#L559-L564)); overlay `<canvas>` JSX
  ([:1356-1366](src/components/Canvas.tsx#L1356-L1366)); a single `ctx.setTransform`/translate
  at the top of `drawOverlay` after `clearRect`
  ([:590](src/components/Canvas.tsx#L590)); `clientToNorm` reference rect
  ([:121-130](src/components/Canvas.tsx#L121-L130)) → use the render canvas rect (add a
  `renderCanvasRef` read or pass a rect); toolbar-anchor scale source
  ([:1321-1327](src/components/Canvas.tsx#L1321-L1327)) → render canvas rect. Introduce one
  `BLEED` / `M` constant near the other overlay constants ([:110-117](src/components/Canvas.tsx#L110-L117)).
- **R2 touch points:** the anchoring `useLayoutEffect`
  ([:1287-1343](src/components/Canvas.tsx#L1287-L1343)) — add the visible-range computation,
  the fits-inside `roomAbove/roomBelow` decision, the pin case, and the two-axis clamp; watch
  the `translateY(-100%)` interaction in the JSX
  ([:1405-1422](src/components/Canvas.tsx#L1405-L1422)).
- **R3 touch points:** new pref helper (`src/lib/canvasSizePref.ts` or a hook) with try/catch
  load/save; `createDefaultProject()` ([src/types.ts:229](src/types.ts#L229)) gains an optional
  `size` arg; `useProject` initializer ([useProject.ts:254](src/hooks/useProject.ts#L254)) seeds
  it from the pref; a save-on-change effect in `useProject`/`App` writes the pref when
  `present.width/height` change. Validate loaded dims with `sanitizeDimension`. No `Project`/reducer
  type changes.
- **R4 touch points:** [LeftRail.tsx:45-70](src/components/LeftRail.tsx#L45-L70) (active-icon button
  markup — replace/augment the `w-0.5` accent bar with a caret + optional shared surface). Pure
  Tailwind/JSX; no prop or type changes.
- **R5 touch points:** `TextData` ([src/types.ts:100-107](src/types.ts#L100-L107)) gains
  `cornerRadius?`; `drawText` background fill ([annotations.ts:293-296](src/lib/annotations.ts#L293-L296))
  switches to `roundRect` when set (clamped by `scaleFactor` and box size); a "Corner radius" `Field`
  in the text section of [PropertiesPanel.tsx:470-491](src/components/PropertiesPanel.tsx#L470-L491)
  via the existing `updateData` helper. If OQ7 → (b), also add `borderColor?`/`borderWidth?` +
  a stroke pass + panel controls.
- **R6 touch points:** [Canvas.tsx](src/components/Canvas.tsx) — `handleDoubleClick`
  ([:1212](src/components/Canvas.tsx#L1212)) detects a text hit and sets a new `editingTextId` state; a
  `<textarea>` sibling in the fit box positioned via the toolbar-anchor mapping
  ([:1321-1327](src/components/Canvas.tsx#L1321-L1327)); `UPDATE_OBJECT_TRANSIENT`→`COMMIT_TRANSIENT`
  for content; suppress drag/key handlers while editing. No renderer/type changes.
- **R7 touch points:** `Accordion` default open state
  ([PropertiesPanel.tsx:761](src/components/PropertiesPanel.tsx#L761)) `useState(true)` → `false`
  (optionally add a `defaultOpen?` prop).
- **R8 (text effects):** moved to [19-text-effects](19-text-effects.md) — not part of this batch's
  implementation.
- Verify per `.claude/skills/verify` — static checks only (`npx tsc -b`), then hand the user a
  "click X, look for Y" checklist covering the in-scope ACs (AC1–AC11). Do **not** run the dev server /
  browser.

---
*This specification is ready for implementation. Use `/task 18-qol` to begin development.*
