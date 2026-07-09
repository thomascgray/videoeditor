# 12-keyframe-easing-engine

## Overview

Add a **keyframe + easing engine**: the ability to interpolate an object's properties (`x`, `y`, `width`, `height`, `rotation`, `opacity`) between values over time along a chosen easing curve. This is the foundational animation primitive the editor is missing — "move this text from position A to position B with a configurable ease" is exactly this feature, and **two other planned features ride on the same primitive**:

- **Spec 13 (camera/zoom)** is a project-level keyframeable `{x, y, scale}` applied as one transform — same interpolation + easing core, different target.
- **Spec 15 (audio fades)** is a volume envelope over time — same easing math, applied in the audio pipeline instead of the renderer.

So the highest-leverage move is to build the interpolation + easing core **once**, cleanly, and let the three consumers share it.

### What exists today (grounded)

The only animation in the codebase is a single scalar `animateIn` per object (`types.ts:21`) → a **linear** `progress` ramp (`renderer.ts:42-46`):

```ts
const elapsed = globalTime - obj.startTime
const progress = obj.animateIn > 0 ? Math.min(1, elapsed / obj.animateIn) : 1
```

`progress` is interpreted by each `draw*` fn as a **reveal fraction** of one *static* shape (typewriter text, arrow draw-on, freehand point count — `annotations.ts`). There is **no value-interpolation between two states anywhere**, no easing curves (only geometric bezier math for arrow curvature — `quadBezierAt`, `segmentControlPoint`), and no `lerp` utility. A repo-wide search for `keyframe`/`easing`/`tween`/`interpolate` found nothing in animation logic. This engine is entirely new.

Crucially, `renderFrame` (`renderer.ts:21`) is a **pure function shared by preview and export** (`useCanvasRenderer.ts:45` and `exportWorker.ts` both call it), so interpolation added there animates identically in the editor and in exported MP4 — for free.

## Requirements

### Data model
- **R1**: Objects gain an optional per-property keyframe structure. When a property has a keyframe track, its value at time *t* is interpolated from the track; when it doesn't, the object's existing static value is used (fully backward-compatible — an object with no keyframes renders exactly as today).
- **R2**: Animatable properties for v1: `x`, `y`, `width`, `height`, `rotation`, `opacity`. (`opacity` animates `style.opacity`; the rest are top-level fields.)
- **R3**: Keyframe times are stored **relative to `object.startTime`** (0 = clip start), so moving or (spec 14) trimming a clip keeps its animation aligned.
- **R4**: Each keyframe carries an easing curve that governs the segment **from that keyframe to the next**. Provide at minimum: `linear`, ease-in/out quad, ease-in/out cubic, `easeOutBack`, and `spring`.

### Rendering
- **R5**: `renderFrame` interpolates each object's animatable properties before drawing. Interpolation composes with the existing `animateIn` reveal (they are orthogonal: keyframes move/scale/rotate/fade the shape; `animateIn` still controls the draw-on reveal within it).
- **R6**: The engine works identically in preview and export (guaranteed by putting it inside `renderFrame`). No export-specific code path.

### Editing UX
- **R7**: A user can, from the properties panel, turn a property into an A→B animation: set a start value and an end value (or "use current as end"), pick an easing, and see it play. This is the MVP the ticket asks for.
- **R8**: One-click templates that populate a 2-keyframe track: **slide in from left/right/top/bottom**, **pop/scale-in**, **fade in**, and their **-out** variants (spec: an exit animation is the same track reversed — see R9).
- **R9**: Keyframe edits integrate with undo the same way drag gestures do — a continuous edit (e.g. dragging a keyframe or a value slider) collapses to a **single** undo entry via the existing `UPDATE_OBJECT_TRANSIENT` → `COMMIT_TRANSIENT` protocol, not one entry per tick.

### Correctness
- **R10**: `DUPLICATE_OBJECT` must **deep-clone** the keyframe structure (today it shallow-spreads `data`/`style`, so a keyframes array would be shared by reference between the original and the copy — a latent aliasing bug).
- **R11**: No behavioral change for objects without keyframes (preview and export byte-identical to today).

## Technical Considerations

### Proposed types (new, in `src/types.ts`)

```ts
export type EasingKind =
  | 'linear'
  | 'easeInQuad'  | 'easeOutQuad'  | 'easeInOutQuad'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeOutBack'
  | 'spring'

export type AnimatableProperty = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity'

export type Keyframe = {
  time: number         // seconds, relative to object.startTime (0 = clip start)
  value: number
  easing: EasingKind   // curve applied on the segment FROM this keyframe TO the next
}

// Each track is sorted by `time` ascending. A property absent from the map is not animated.
export type KeyframeTracks = Partial<Record<AnimatableProperty, Keyframe[]>>
```

`TimelineObject` (`types.ts:5-28`) gains one optional field (additive, backward-compatible):

```ts
  keyframes?: KeyframeTracks
```

### Existing types this touches (verbatim, `src/types.ts`)

```ts
export type TimelineObject = {
  id: string
  type: TimelineObjectType
  name: string
  startTime: number       // global seconds
  duration: number        // seconds visible
  lane: number
  x: number; y: number; width: number; height: number   // normalised 0–1
  rotation: number        // radians, rotation around center of bounding box
  animateIn: number       // seconds for draw-on animation (0 = instant)
  style: ObjectStyle
  data: PhotoData | ArrowData | TextData | ShapeData | FreehandData | AudioData | VideoData
}

export type ObjectStyle = {
  color: string; lineWidth: number; opacity: number
  fontSize?: number; fontFamily?: string; fontWeight?: string
}
```

### Evaluation semantics

For a property `P` with track `kfs` at clip-relative time `t = globalTime - obj.startTime`:
- No track / empty → use static `obj[P]` (or `obj.style.opacity` for `opacity`).
- `t <= kfs[0].time` → `kfs[0].value` (hold before first key).
- `t >= kfs[last].time` → `kfs[last].value` (hold after last key).
- Else find bracketing pair `[a, b]`, `u = (t - a.time) / (b.time - a.time)`, `eased = ease(a.easing, u)`, `value = a.value + (b.value - a.value) * eased`.

### renderFrame integration (`src/lib/renderer.ts`)

`renderFrame` already computes `elapsed` and `progress` per object (`renderer.ts:42-46`). Add a resolve step that produces an **effective pose** and hands `drawObject` an object with the interpolated fields:

- New pure helper `evaluatePose(obj, elapsed): { x, y, width, height, rotation, opacity }` — resolves each animatable property (track or static fallback).
- Construct `const eff = { ...obj, x: pose.x, y: pose.y, width: pose.width, height: pose.height, rotation: pose.rotation, style: { ...obj.style, opacity: pose.opacity } }` and pass `eff` where `obj` currently goes. `drawObject` reads `obj.x/y/width/height/rotation` and `style.opacity` (`renderer.ts:79-98,105,131`), so this is minimally invasive and the reveal-multiply `style.opacity * progress` stays intact.

### Easing + interpolation core (new `src/lib/easing.ts`)

Pure functions, engine-agnostic, so spec 13 (camera) and spec 15 (audio) can import them:
- `ease(kind: EasingKind, u: number): number` — maps 0–1 → 0–1 (spring may overshoot >1, which is fine for position/scale; opacity should be clamped by the caller).
- `lerp(a, b, u)` and `evaluateTrack(kfs: Keyframe[], t: number): number` (the R-block semantics above).

There is **no** existing easing/lerp code to reuse — `annotations.ts` bezier is geometric, not temporal.

### Third-party library decision: Motion (motion.dev) — utilities only

Evaluated adopting [Motion](https://motion.dev/docs) as the foundation. **Decision: use Motion's pure math utilities, not its component/playback layer.** Rationale is dictated by two hard constraints of this app:

1. **Deterministic sample-at-t.** `renderFrame` is a pure function of `globalTime`; export renders frame `f` at `globalTime = f/fps` and must ask "value of property P at exactly t." A playback/clock-driven animator (Motion's `animate()`, `motion.*` components, `useAnimate` — all rAF/browser-timeline driven) cannot sample at an arbitrary t, and using clock-driven playback for preview while export samples at t would make **exported video diverge from preview**. Pure sampling is a correctness requirement, not a preference.
2. **Headless Web Worker export.** `exportWorker.ts` composites onto an `OffscreenCanvas` in a worker — no DOM, no elements, no rAF. Motion's component/hook layer has nothing to bind to there.

So the `motion` / `motion/react` component and `animate()` layers are **excluded** (paradigm mismatch, and they'd break export parity). What we **do** adopt is Motion's pure, DOM-free, deterministic utilities behind our own `easing.ts`:
- Named easings + `cubicBezier(...)` → back the `EasingKind` map (R4) instead of hand-rolling curves.
- A **duration-based, samplable `spring`** → the `spring` `EasingKind`. This is the strongest reason to take the dependency: a spring that samples at arbitrary `t` **and** has a bounded, known duration (so a keyframe segment has a defined length) is the fiddly part to hand-roll; Motion's duration-based spring solves exactly that.
- `interpolate`/`transform` + `mix` → range mapping inside `evaluateTrack` (optional; `lerp` suffices for scalars).

**What stays ours:** the `KeyframeTracks` data model and the `evaluateTrack` bracket-and-sample logic (find surrounding keyframes → normalize to 0–1 → apply curve → lerp) — domain logic tied to our types and clip-relative time; no library owns it better, and keeping it ours keeps `renderFrame` pure. `easing.ts` is a **thin wrapper**: if Motion's import surface ever bloats the bundle, the internals swap for ~50 lines without touching any caller (spec 13/15 import our `ease`/`evaluateTrack`, never Motion directly).

**Bundle:** the user has explicitly accepted bundle size ("it's a full web video editor, it was always going to be huge"), so chunk size is **not a gate**. Still prefer importing the leaf utilities (`cubicBezier`/`spring`/`interpolate`) from the framework-agnostic `motion` entry rather than `motion/react`, to keep React out of the math path — a hygiene choice, not a blocker. No animation library is currently a dependency (`package.json`: react 19, tailwind, mp4-muxer, mp4box, jszip).

### Editing UX (v1) — keyframes in the right panel (no timeline dots)

**Decision (per user):** all keyframe editing lives in the right-hand `PropertiesPanel`; no on-timeline keyframe dots or on-canvas gizmos in v1 ("fancy UX later"). This requires threading the current playhead time into the panel — `PropertiesPanel` today receives only `object` + `dispatch` (`PropertiesPanel.tsx`), so `App` must also pass `globalTime` and a `seek(t)` (both already live in `usePlayback`).

**Mental model:** a keyframe cements the object's *pose* at a moment in time; the segments between consecutive keyframes are the tweens. "Current time" is the playhead, expressed clip-relative (`globalTime - obj.startTime`), matching how keyframe `time` is stored (R3).

**The Animation `<Section>`** (new, shown for animatable object types; mirrors the existing `<Section>`/`<Field>` pattern):
- **`+ Keyframe` button** — cements the object's current pose (x, y, width, height, rotation, opacity) as a keyframe at the current playhead time. If one already exists within a small epsilon of that time, it updates it.
- **Keyframe list** — one row per keyframe: its clip-relative time (e.g. `1.5s`), an **easing** dropdown (governs the *outgoing* segment to the next keyframe), and delete (✕). Clicking the time `seek()`s the playhead there so that pose is visible and editable.
- **Prev / next keyframe** nav (◀ ◆ ▶) — jumps the playhead between this object's keyframes; the diamond is filled when the playhead sits exactly on one.
- **Live value semantics once keyframed:** the existing Position/Style inputs display the *interpolated* pose at the playhead. Editing any value cements a keyframe at the current time (updating the one there, or creating a new one that snapshots the interpolated pose plus the changed value). This is the "set animations to/from a keyframe" flow — scrub to a new time, tweak a value, and a keyframe is born defining the tween from the previous one.
- **Templates** (R8) are one-click shortcuts that write two keyframes (e.g. off-screen-left pose → current pose over a default duration).
- **Empty state:** no keyframes → object renders at its static pose (today's behavior); the first `+ Keyframe` cements it.

Rough panel sketch:

```
┌ Animation ─────────────────────────┐
│  ◀  ◆  ▶        [ + Keyframe ]      │
│  ─────────────────────────────────  │
│  0.0s   ease-out   ▾            ✕   │
│  1.5s   ease-in-out ▾          ✕   │   ← click a time to seek there
│  ─────────────────────────────────  │
│  Templates: [slide-in ▾] [pop] [fade]│
└────────────────────────────────────┘
```

**Storage vs. UI:** store per-property `KeyframeTracks` (flexible; serves the camera in spec 13 and audio fades in spec 15 uniformly), but the v1 pose UI writes **all** visual animatable properties at each keyframe time (a constant property just gets equal-valued keyframes). This keeps the simple "cement a whole moment" authoring model while leaving per-property storage in place for a later per-property UI. Trade-off to accept: writing all props "pins" them across the animated window (changing an object's base value won't show while keyframes cover that time). Predictable and fine for v1.

### Undo / reducer interaction (`src/hooks/useProject.ts`)

- The reducer merges `updates` **shallowly** (`{ ...o, ...action.updates }`, `useProject.ts:90-96`), so keyframe edits must dispatch the **whole** `keyframes` object each time (same pattern PropertiesPanel already uses for `data`/`style`).
- Continuous edits use `UPDATE_OBJECT_TRANSIENT` (stashes a pre-edit snapshot, no history growth) then `COMMIT_TRANSIENT` (collapses to one `past` entry) — `useProject.ts:38-60`. **Note:** PropertiesPanel today dispatches plain `UPDATE_OBJECT` on every keystroke/slider tick (`PropertiesPanel.tsx:17-23`), spamming history; keyframe drag UIs should adopt the transient protocol that `Canvas.tsx`/`Timeline.tsx` drags already use.
- **R10 fix**: extend `DUPLICATE_OBJECT` (`useProject.ts:98-111`) to deep-clone `keyframes` (and ideally `data`) rather than sharing references.

### Performance
Interpolation is a handful of arithmetic ops per animatable property per visible object per frame — negligible next to canvas raster work. No memoization needed for v1.

## Related Systems and Tasks

- **Foundation for `SPECS/13-camera-zoom.md`** (reuses `easing.ts` + `evaluateTrack` for the camera `{x,y,scale}` track) and **`SPECS/15-audio-polish.md`** (reuses the easing math for volume fades, applied in the audio pipeline).
- `src/lib/renderer.ts` — `renderFrame`/`drawObject` (the integration point).
- `src/lib/annotations.ts` — existing `progress`-as-reveal-fraction mechanism (orthogonal; unchanged).
- `src/components/PropertiesPanel.tsx` — where the animation-editing UI slots in (currently only `UPDATE_OBJECT`).
- `src/hooks/useProject.ts` — transient/commit undo protocol; `DUPLICATE_OBJECT` clone fix.
- `SPECS/09-in-video-perf.md` — note A3 (decoupling canvas render from 60Hz React state); a keyframe editor UI should not reintroduce per-frame whole-app re-renders.

## Open Questions

1. **Editing surface — RESOLVED: right panel only.** All keyframe editing lives in `PropertiesPanel` (no timeline dots / canvas gizmos in v1). See *Editing UX (v1)* in Technical Considerations. A timeline-dot editor stays a purely-additive future option.
2. **Data shape — RESOLVED (pending final nod): per-property storage + pose-style panel UI.** Store per-property `KeyframeTracks`; the v1 panel authors whole-pose keyframes (writes all visual animatable props per keyframe). See *Editing UX (v1)*. Confirm you're happy with "a keyframe = a whole-pose snapshot" as the authoring model for v1 (per-property diamonds come later).
3. **Spring parameters.** Expose stiffness/damping, or ship a single tuned `spring` preset? With Motion's duration-based spring (see Technical Considerations), a preset = fixed `visualDuration` + `bounce`. *(Recommended: one tuned preset for v1; parameterize later.)*
6. **Motion dependency — RESOLVED: adopt (utilities only).** User accepted bundle size, so the tree-shaking check is a nice-to-have, not a gate. Depend on Motion for pure easing/spring/interpolate math behind `easing.ts`; exclude its component/`animate()` layer.
4. **Does `opacity` animation stack with `animateIn` reveal?** Both multiply into alpha today. Confirm designers want an object to be able to both fade (keyframe) and draw-on (`animateIn`) simultaneously. *(Recommended: yes — they're orthogonal; keep the multiply.)*
5. **Rotation interpolation across wrap.** Radians interpolate linearly; a template that spins >180° should author intermediate keyframes rather than relying on shortest-arc logic. *(Recommended: linear on stored radians; no shortest-arc magic in v1.)*

## Acceptance Criteria

- A text object can be given a start and end position + an easing, and it visibly tweens A→B during its clip window in **both** preview and exported MP4, with the chosen curve.
- One-click "slide in from left" and "fade in" templates work end-to-end.
- Editing an animation (dragging a value/keyframe) produces exactly **one** undo entry per gesture; Ctrl+Z reverts the whole gesture.
- Duplicating an animated object produces an independent copy — editing the copy's animation does not change the original's.
- An object with no keyframes renders pixel-identically to today in preview and export (no regressions for photo/annotation/audio/video-only projects).

## Implementation Notes

- Add `src/lib/easing.ts` (pure `ease`/`lerp`/`evaluateTrack`) first — it's the shared primitive; unit-test the curves and boundary/hold behavior.
- Add `keyframes?: KeyframeTracks` to `TimelineObject` and the new types to `types.ts`.
- Integrate in `renderFrame` via an `evaluatePose` helper + effective-object spread (keep `drawObject`'s signature; don't thread new params through every `draw*`).
- PropertiesPanel: add an **Animation** `<Section>` (mirror the existing section pattern, `PropertiesPanel.tsx:271`); wire drag/slider edits through `UPDATE_OBJECT_TRANSIENT`/`COMMIT_TRANSIENT`.
- Fix `DUPLICATE_OBJECT` deep-clone in `useProject.ts`.
- Validate: `npx tsc -b` clean, and manually export a project with an A→B tween to confirm preview/export agree.

---
*Draft — nearly ready. Resolved: right-panel-only editing (Q1), Motion utilities adopted (Q6). Last nod needed: Q2 (confirm whole-pose keyframe authoring for v1) before `/task 12`.*
